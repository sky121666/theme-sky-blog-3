// Source-only rendering of 2.27 OpenAPI presentation subsets with real Thymeleaf.
// The supplied runtime/application.jar is older than 2.27: its DTOs are NOT used.
// Compile together with ShopOrderTemplateFixture.java; never invoke Halo or write data.
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.thymeleaf.context.Context;

public class ShopOrderStatesFixture extends ShopOrderTemplateFixture {
  static final List<Map<String,Object>> results = new ArrayList<>();
  static Path output;

  static String json(Object value) throws Exception {
    if (value == null) return "null";
    if (value instanceof Number || value instanceof Boolean) return value.toString();
    if (value instanceof String || value instanceof Enum<?> || value instanceof java.time.Instant)
      return "\"" + value.toString().replace("\\", "\\\\").replace("\"", "\\\"")
          .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + "\"";
    if (value instanceof Collection<?> values) {
      List<String> parts = new ArrayList<>(); for (Object part : values) parts.add(json(part));
      return "[" + String.join(",", parts) + "]";
    }
    if (value instanceof Map<?,?> values) {
      List<String> parts = new ArrayList<>();
      for (var entry : values.entrySet()) parts.add(json(entry.getKey().toString()) + ":" + json(entry.getValue()));
      return "{" + String.join(",", parts) + "}";
    }
    Map<String,Object> object = new LinkedHashMap<>();
    if (value.getClass().isRecord()) {
      for (var component : value.getClass().getRecordComponents()) object.put(component.getName(), component.getAccessor().invoke(value));
    } else {
      for (var field : value.getClass().getFields()) object.put(field.getName(), field.get(value));
    }
    return json(object);
  }

  static void render(String name, Order227 order, boolean locked, boolean authenticated,
      boolean canPay, boolean canCancel, List<Fulfillment227> fulfillments, List<String> sent) throws Exception {
    var variables = model(order, locked, authenticated, canPay, canCancel, fulfillments, sent);
    var result = new LinkedHashMap<String,Object>();
    result.put("name", name); result.put("model", variables); results.add(result);
    try {
      String html = engine.process("modules/shop-app/order-detail", Set.of("detail"), new Context(Locale.CHINA, variables));
      Document doc = Jsoup.parse(html);
      Element section = one(doc, "section.shop-order");
      Document official = Jsoup.parse(officialEngine.process(officialTemplate, new Context(Locale.CHINA, variables)));
      Element comparable = section.clone();
      comparable.select("a[download][href^=/shop/order/][href$=/download]").removeAttr("download");
      equal(comparable.outerHtml(), one(official, "section.shop-order").outerHtml(), name + " official rendered parity");
      equal(doc.select("script").size(), 0, name + " no injected scripts");
      equal(doc.select("[th\\:if], [th\\:text], [th\\:each]").size(), 0, name + " all directives processed");
      Files.writeString(output.resolve(name + ".html"), section.outerHtml());
      result.put("passed", true);
      result.put("officialParity", true);
      result.put("badges", doc.select(".shop-order-header__badges .shop-order-badge").eachText());
      result.put("fulfillmentBadges", doc.select(".shop-order-fulfillment__head .shop-order-badge").eachText());
      result.put("renderedFile", name + ".html");
    } catch (Throwable error) {
      result.put("passed", false); result.put("error", error.toString());
    }
  }

  static Fulfillment227 shipment(FulfillmentType type, FulfillmentStatus status, OrderItem227 item) {
    return new Fulfillment227(type, status,
      List.of(new Label227("顺丰测试承运商", "SF-MOCK-20261026000000000000000000000001", "https://tracking.example.test/mock-shipment"),
        new Label227("人工配送", "NO-TRACKING-URL", null)),
      List.of(new FulfillmentItem227(item, "模拟签收说明：请先核对外包装。\n工作日配送，联系信息仅用于测试。", null, null)));
  }

  public static void main(String[] args) {
    try { generate(args); } catch (Exception error) { throw new RuntimeException(error); }
  }

  static void generate(String[] args) throws Exception {
    Path root = Path.of(args[0]).toAbsolutePath();
    output = Files.createDirectories(Path.of(args[2]));
    engine = engine(root.resolve("templates"));
    Path upstream = Path.of(args[1]).toAbsolutePath();
    officialEngine = engine(upstream.getParent());
    officialTemplate = upstream.getFileName().toString().replaceFirst("\\.html$", "");
    TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));

    render("pending-guest", new Order227(), false, false, true, true, List.of(), null);
    render("pending-member", new Order227(), false, true, true, true, List.of(), null);
    render("pending-capabilities-denied", new Order227(), false, true, false, false, List.of(), null);
    render("paid", paid(), false, true, false, false, List.of(), null);
    for (PaymentStatus status : List.of(PaymentStatus.AUTHORIZING, PaymentStatus.FAILED, PaymentStatus.EXPIRED, PaymentStatus.CANCELLED)) {
      Order227 order = new Order227(); order.paymentStatus = status;
      if (status == PaymentStatus.CANCELLED) order.status = OrderStatus.CANCELLED;
      render(status.name().toLowerCase(Locale.ROOT), order, false, true, false, false, List.of(), null);
    }
    Order227 partial = paid(); partial.refundStatus = RefundStatus.PARTIAL;
    render("partial-refund", partial, false, true, false, false, List.of(), null);
    Order227 full = paid(); full.refundStatus = RefundStatus.FULL; full.paymentStatus = PaymentStatus.REFUNDED;
    render("full-refund", full, false, true, false, false, List.of(), null);
    Order227 archived = paid(); archived.status = OrderStatus.ARCHIVED;
    render("archived", archived, false, true, false, false, List.of(), null);

    Order227 physical = paid();
    physical.shippingAddress = new Address227("浙江省", "杭州市", "滨江区", "模拟街道 26 号测试园区 3 栋 1206 室", "张", "模拟", "00000000000");
    for (FulfillmentStatus status : FulfillmentStatus.values()) {
      render("physical-" + status.name().toLowerCase(Locale.ROOT), physical, false, true, false, false,
        List.of(shipment(FulfillmentType.SHIPPING, status, physical.items.getFirst())), null);
    }
    render("pickup-and-local-delivery", physical, false, true, false, false,
      List.of(shipment(FulfillmentType.PICKUP, FulfillmentStatus.READY, physical.items.getFirst()),
        shipment(FulfillmentType.LOCAL_DELIVERY, FulfillmentStatus.PROCESSING, physical.items.getFirst())), null);

    Order227 digital = paid();
    digital.items = List.of(new OrderItem227("模拟数字资源 <script>throw 'injection'</script>", null, null, null,
      new BigDecimal("90.00"), 1, new BigDecimal("90.00")));
    var delivery = new Fulfillment227(FulfillmentType.VIRTUAL, FulfillmentStatus.COMPLETED, List.of(),
      List.of(new FulfillmentItem227(digital.items.getFirst(), "模拟数字交付说明 <b>必须按文本展示</b>",
        List.of(new Resource227(ResourceType.ATTACHMENT, "resource-public-id", "模拟附件下载", null, "private-attachment-id"),
          new Resource227(ResourceType.STATIC_URL, "external-resource-id", "模拟外部资源", "https://resource.example.test/mock-file?a=1&b=2", null)),
        List.of(new Cdk227("MOCK-CDK-NOT-REAL", "MOCK-SECRET<&"), new Cdk227("MOCK-CODE-ONLY", null)))));
    render("digital-delivery", digital, false, true, false, false, List.of(delivery), null);
    render("locked-hides-digital", digital, true, true, true, true, List.of(delivery), null);
    render("locked-sent", null, true, false, false, false, null, List.of("true"));

    Order227 subscription = paid();
    subscription.items = List.of(new OrderItem227("模拟专业订阅年度计划", null, "/shop/product/mock-subscription",
      Map.of("planId", 5902, "planName", "专业年付", "billingMode", "SUBSCRIPTION", "billingPeriod", "YEARLY", "feeType", "FIXED_FEE", "type", "INITIAL"),
      new BigDecimal("90.00"), 1, new BigDecimal("90.00")));
    render("subscription-metadata", subscription, false, true, false, false, List.of(), null);

    Order227 longOrder = paid();
    String longTitle = "长标题测试：专业设计资源订阅与实体礼盒组合套装（年度完整版、家庭共享、含赠品）".repeat(4);
    longOrder.items = List.of(new OrderItem227(longTitle, "/upload/fixture.webp", "/shop/product/fixture-alias", null,
      new BigDecimal("1234567.89"), 2, new BigDecimal("2469135.78")));
    longOrder.subtotalAmount = new BigDecimal("2469135.78"); longOrder.shippingAmount = new BigDecimal("20.00");
    longOrder.discountAmount = new BigDecimal("10.00"); longOrder.couponDiscountAmount = new BigDecimal("5.00");
    longOrder.payableAmount = new BigDecimal("2469140.78"); longOrder.paidAmount = longOrder.payableAmount;
    longOrder.customerNotes = "长备注演示：请联系模拟收件人并核对全部物品。".repeat(5);
    longOrder.shippingAddress = new Address227("浙江省", "杭州市", "滨江区", "测试大道".repeat(20) + " Building-" + "A".repeat(100), "测试", "收件人", "00000000000");
    render("long-content", longOrder, false, true, false, false,
      List.of(shipment(FulfillmentType.SHIPPING, FulfillmentStatus.SHIPPED, longOrder.items.getFirst())), null);
    Files.writeString(output.resolve("ssr-results.json"), json(results));
    long failures = results.stream().filter(r -> !Boolean.TRUE.equals(r.get("passed"))).count();
    System.out.println("SSR " + (results.size() - failures) + "/" + results.size() + "; official fragment comparison; OpenAPI presentation subsets, not runtime 2.27 DTOs");
    if (failures > 0) System.exit(1);
  }
}
