package com.roadstar.loader;

import com.google.gson.Gson;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import xf.xflp.XFLP;
import xf.xflp.opt.XFLPOptType;
import xf.xflp.report.LPPackageEvent;
import xf.xflp.report.LoadType;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;

public final class LoaderServer {
    private static final Gson GSON = new Gson();

    record Trailer(String id, int lengthIn, int widthIn, int heightIn, float capacityLbs,
                   float frontAxleLimitLbs, float rearAxleLimitLbs, float axleDistanceIn, boolean axleModelVerified) {}
    record Load(String id, String destination, float weightLbs, int pallets, int stop,
                int palletLengthIn, int palletWidthIn, int palletHeightIn,
                boolean rotatable, boolean stackable, float bearingLimitLbs, float floorBearingPsf,
                boolean fragile, boolean priority, boolean estimated) {}
    record PlanRequest(Trailer trailer, List<Load> loads) {}
    record Item(String id, String loadId, int x, int y, int z, int length, int width, int height,
                float weightLbs, int stop, String destination, String color, boolean estimated,
                boolean rotated, boolean invalid, String unplannedReason) {}
    record PlanResponse(List<Item> items, List<Item> unplanned, float totalWeight,
                        float usedFloorArea, List<String> warnings, String engine) {}

    public static void main(String[] args) throws Exception {
        String host = System.getenv().getOrDefault("SOLVER_HOST", "127.0.0.1");
        int port = Integer.parseInt(System.getenv().getOrDefault("SOLVER_PORT", "7070"));
        HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
        server.createContext("/api/health", exchange -> send(exchange, 200, "{\"status\":\"ok\",\"engine\":\"xflp-0.7.7\"}"));
        server.createContext("/api/plan", LoaderServer::plan);
        server.setExecutor(null);
        server.start();
        System.out.println("RoadStar xflp service ready at http://" + host + ":" + port);
    }

    private static void plan(HttpExchange exchange) throws IOException {
        cors(exchange);
        if ("OPTIONS".equals(exchange.getRequestMethod())) { exchange.sendResponseHeaders(204, -1); return; }
        if (!"POST".equals(exchange.getRequestMethod())) { send(exchange, 405, "{\"error\":\"POST required\"}"); return; }
        try {
            PlanRequest request = GSON.fromJson(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8), PlanRequest.class);
            send(exchange, 200, GSON.toJson(solve(request)));
        } catch (Exception error) {
            send(exchange, 400, GSON.toJson(Map.of("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage())));
        }
    }

    private static PlanResponse solve(PlanRequest request) throws Exception {
        if (request == null || request.trailer == null || request.loads == null) throw new IllegalArgumentException("Trailer and loads are required");
        XFLP solver = new XFLP();
        solver.setTypeOfOptimization(XFLPOptType.FAST_FIXED_CONTAINER_PACKER_RAND);
        solver.getParameter().setLifoImportance(1);
        solver.getParameter().setMaxNbrOfContainer(1);
        Trailer t = request.trailer;
        if (t.id == null || t.id.isBlank() || t.lengthIn <= 0 || t.widthIn <= 0 || t.heightIn <= 0 || t.capacityLbs <= 0) {
            throw new IllegalArgumentException("Trailer dimensions and capacity must be positive");
        }
        var container = solver.addContainer().setContainerType(t.id).setLength(t.lengthIn).setWidth(t.widthIn).setHeight(t.heightIn).setMaxWeight(t.capacityLbs);
        if (t.axleModelVerified && t.frontAxleLimitLbs > 0 && t.rearAxleLimitLbs > 0 && t.axleDistanceIn > 0) {
            container.setFirstPermissibleAxleLoad(t.frontAxleLimitLbs);
            container.setSecondPermissibleAxleLoad(t.rearAxleLimitLbs);
            container.setAxleDistance(t.axleDistanceIn);
        }
        Map<String, Load> byItem = new HashMap<>();
        List<Item> rejected = new ArrayList<>();
        for (Load load : request.loads) {
            if (load == null || load.id == null || load.id.isBlank() || load.pallets <= 0 || load.weightLbs <= 0 ||
                load.stop <= 0 || load.palletLengthIn <= 0 || load.palletWidthIn <= 0 || load.palletHeightIn <= 0) {
                throw new IllegalArgumentException("Every load requires an id, positive pallet count, weight, stop, and pallet dimensions");
            }
            float weight = load.weightLbs / load.pallets;
            float densityPsf = weight / (load.palletLengthIn * load.palletWidthIn) * 144;
            for (int i=1; i<=load.pallets; i++) {
                String id = load.id + "-P" + String.format("%02d", i);
                byItem.put(id, load);
                if (load.floorBearingPsf > 0 && densityPsf > load.floorBearingPsf) {
                    rejected.add(new Item(id, load.id, 0, 0, 0, load.palletLengthIn, load.palletWidthIn, load.palletHeightIn, weight, load.stop, load.destination, "#ff4d4d", load.estimated, false, true, "Floor-bearing limit exceeded."));
                    continue;
                }
                solver.addItem().setExternID(id).setShipmentID(load.id)
                    .setLength(load.palletLengthIn).setWidth(load.palletWidthIn).setHeight(load.palletHeightIn)
                    .setWeight(weight).setSpinnable(load.rotatable)
                    .setStackingWeightLimit(load.stackable && !load.fragile ? load.bearingLimitLbs : 0)
                    .setNbrOfAllowedStackedItems(load.stackable && !load.fragile ? 10 : 0)
                    .setLoadingLocation("LOC-0").setUnloadingLocation(String.format("LOC-%03d", load.stop));
            }
        }
        solver.executeLoadPlanning();
        Map<String, Item> uniquePlacements = new LinkedHashMap<>();
        for (var report : solver.getReport().getContainerReports()) for (LPPackageEvent event : report.getPackageEvents()) {
            if (event.type() == LoadType.LOAD) uniquePlacements.put(event.id(), toItem(event, byItem.get(event.id())));
        }
        List<Item> placed = new ArrayList<>(uniquePlacements.values());
        for (LPPackageEvent event : solver.getReport().getUnplannedPackages()) {
            Item item = toItem(event, byItem.get(event.id()));
            rejected.add(new Item(item.id, item.loadId, item.x, item.y, item.z, item.length, item.width, item.height, item.weightLbs, item.stop, item.destination, item.color, item.estimated, item.rotated, item.invalid, "xflp could not satisfy the selected geometry, stack, weight, or unloading constraints."));
        }
        float totalWeight = (float) placed.stream().mapToDouble(Item::weightLbs).sum();
        float floor = (float) placed.stream().filter(i -> i.z == 0).mapToDouble(i -> i.length * i.width).sum();
        List<String> warnings = new ArrayList<>();
        if (request.loads.stream().anyMatch(load -> load == null || load.estimated)) {
            warnings.add("Pallet geometry and individual weights are estimated from shipment totals. Verify before operational use.");
        }
        if (!t.axleModelVerified) warnings.add("Axle geometry is not calibrated for this tractor pairing. Verify axle weights before release.");
        if (!rejected.isEmpty()) warnings.add(rejected.size() + " pallets could not be planned under the selected constraints.");
        return new PlanResponse(placed, rejected, totalWeight, floor, warnings, "xflp-0.7.7");
    }

    private static Item toItem(LPPackageEvent event, Load load) {
        String[] colors = {"#4ee6a8", "#58a6ff", "#f8c35c", "#e77cff", "#ff735c"};
        int stop = load == null ? 0 : load.stop;
        // xflp reports X across container width and Y along container length.
        // RoadStar's shared contract uses X for trailer length and Y for width.
        return new Item(event.id(), load == null ? "unknown" : load.id, event.y(), event.x(), event.z(),
            event.l(), event.w(), event.h(), event.weight(), stop, load == null ? "Unknown" : load.destination,
            colors[Math.floorMod(stop - 1, colors.length)], load == null || load.estimated, event.isRotatedPosition(), event.isInvalid(), null);
    }

    private static void cors(HttpExchange exchange) {
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "http://localhost:5173");
        exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "POST, OPTIONS");
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    }
    private static void send(HttpExchange exchange, int status, String body) throws IOException {
        cors(exchange); byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
    }
}
