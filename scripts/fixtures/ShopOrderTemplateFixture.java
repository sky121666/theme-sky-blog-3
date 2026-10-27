// Offline rendering with real Thymeleaf/Spring jars, not a Halo server or a real 2.27 DTO test.
// java --class-path "$SHOP_TEMPLATE_JAVA_CLASSPATH" scripts/fixtures/ShopOrderTemplateFixture.java . [official-order.html]
// The jars used for the initial run came from Halo 2.26.1. These synthetic presentation
// properties/enums follow the 2.27 Paid OpenAPI and release/2.27 order template:
// https://github.com/halo-dev/swagger-api-online/blob/89b2453a69ca5f5e5a8ee605fd687d7a14472c16/src/assets/api-docs-paid/2.27/aggregated.json
// Official template commit: 2e03340ca650595b3f3d98a12c6b6be3cc764607.
// This checks rendered markup, not server authorization, CSRF validation, or browser navigation.
import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.function.Consumer;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.thymeleaf.context.Context;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templateresolver.FileTemplateResolver;

public class ShopOrderTemplateFixture {
  static final String ORDER_CODE = "fixture-order-227";
  static final String CSRF = "fixture-csrf<&\"";
  static final String TEXT = "<script>fixtureOnly()</script> & \"订单\"";
  static int passed;
  static SpringTemplateEngine engine;
  static SpringTemplateEngine officialEngine;
  static String officialTemplate;

  // All enum values match the corresponding 2.27 OpenAPI properties. Enum instances
  // deliberately exercise the official template's .name() calls instead of strings.
  public enum PaymentStatus { PENDING, AUTHORIZING, PAID, REFUNDED, FAILED, EXPIRED, CANCELLED }
  public enum OrderStatus { OPEN, ARCHIVED, CANCELLED }
  public enum RefundStatus { NONE, PARTIAL, FULL }
  public enum FulfillmentStatus { PENDING, READY, PROCESSING, SHIPPED, COMPLETED, FAILED, CANCELLED }
  public enum FulfillmentType { SHIPPING, PICKUP, LOCAL_DELIVERY, VIRTUAL }
  public enum ResourceType { ATTACHMENT, STATIC_URL }

  // Presentation-property subsets of OrderResponse, OrderItemResponse,
  // OrderShippingAddress, FulfillmentUcResponse, FulfillmentLabelResponse,
  // FulfillmentItemResponse, CustomerDigitalResourceUcResponse and CdkUcResponse.
  // These are synthetic public Java properties, not imported Halo DTO classes.
  public static class Order227 {
    public String orderCode = ORDER_CODE;
    public Instant createdAt = Instant.parse("2026-10-14T09:00:54Z");
    public PaymentStatus paymentStatus = PaymentStatus.PENDING;
    public OrderStatus status = OrderStatus.OPEN;
    public RefundStatus refundStatus = RefundStatus.NONE;
    public BigDecimal payableAmount = new BigDecimal("90.00");
    public String customerNotes;
    public List<OrderItem227> items = List.of(item());
    public Address227 shippingAddress;
    public BigDecimal subtotalAmount = new BigDecimal("100.00");
    public BigDecimal shippingAmount = new BigDecimal("5.00");
    public BigDecimal discountAmount = new BigDecimal("10.00");
    public String discountName = "折扣";
    public BigDecimal couponDiscountAmount = new BigDecimal("5.00");
    public BigDecimal paidAmount = BigDecimal.ZERO;
  }
  public record OrderItem227(String itemTitle, String itemImageUrl, String permalink,
      Map<String, Object> subscriptionMetadata, BigDecimal unitPrice, Integer quantity,
      BigDecimal subtotal) {}
  public record Address227(String province, String city, String district, String streetAddress,
      String lastName, String firstName, String contactPhone) {}
  public record Fulfillment227(FulfillmentType type, FulfillmentStatus status,
      List<Label227> labels, List<FulfillmentItem227> items) {}
  public record Label227(String carrier, String trackingNumber, String trackingUrl) {}
  public record FulfillmentItem227(OrderItem227 orderItem, String instructions,
      List<Resource227> digitalResources, List<Cdk227> cdks) {}
  public record Resource227(ResourceType resourceType, String publicId, String resourceName,
      String resourceUrl, String attachmentId) {}
  public record Cdk227(String code, String secret) {}

  static OrderItem227 item() {
    return new OrderItem227("测试商品", "/upload/fixture.webp", "/shop/product/fixture-alias",
        null, new BigDecimal("50.00"), 2, new BigDecimal("100.00"));
  }
  static Order227 paid() {
    Order227 order = new Order227();
    order.paymentStatus = PaymentStatus.PAID;
    order.paidAmount = order.payableAmount;
    return order;
  }
  static void equal(Object actual, Object expected, String label) {
    if (!Objects.equals(actual, expected)) {
      throw new AssertionError(label + ": expected " + expected + ", got " + actual);
    }
  }
  static Element one(Document doc, String selector) {
    var elements = doc.select(selector);
    equal(elements.size(), 1, selector + " count");
    return elements.getFirst();
  }
  static SpringTemplateEngine engine(Path directory) {
    FileTemplateResolver resolver = new FileTemplateResolver();
    resolver.setPrefix(directory.toAbsolutePath() + "/");
    resolver.setSuffix(".html");
    resolver.setCharacterEncoding("UTF-8");
    resolver.setCacheable(false);
    SpringTemplateEngine result = new SpringTemplateEngine();
    result.setTemplateResolver(resolver);
    return result;
  }
  static Map<String, Object> model(Order227 order, boolean locked, boolean authenticated,
      boolean canPay, boolean canCancel, List<Fulfillment227> fulfillments, List<String> sent) {
    Map<String, Object> variables = new HashMap<>();
    variables.put("locked", locked);
    variables.put("authenticated", authenticated);
    variables.put("canPay", canPay);
    variables.put("canCancel", canCancel);
    variables.put("orderCode", ORDER_CODE);
    variables.put("_csrf", Map.of("token", CSRF));
    // Thymeleaf WebEngineContext exposes each request parameter as a List-like
    // RequestParameterValues object. Model its null/nonempty/empty states here.
    Map<String, Object> parameters = new HashMap<>();
    parameters.put("sent", sent);
    variables.put("param", parameters);
    if (order != null) variables.put("order", order);
    if (fulfillments != null) variables.put("fulfillments", fulfillments);
    return variables;
  }
  static void run(String name, Map<String, Object> variables, Consumer<Document> checks) {
    Document doc = Jsoup.parse(engine.process("modules/shop-app/order-detail", Set.of("detail"),
        new Context(Locale.CHINA, variables)));
    one(doc, "section.shop-order");
    equal(doc.select("script").size(), 0, name + " has no page scripts or unescaped script text");
    for (Element form : doc.select("form")) {
      equal(form.attr("method").toLowerCase(Locale.ROOT), "post", name + " native POST");
      equal(form.select("input[type=hidden][name=_csrf]").size(), 1, name + " one CSRF field");
      equal(form.selectFirst("input[name=_csrf]").attr("value"), CSRF, name + " escaped CSRF value");
      equal(form.hasAttr("data-shop-search") || form.hasAttr("data-shop-filter"), false,
          name + " native transaction form is not a browse form");
    }
    if (officialEngine != null) {
      Document official = Jsoup.parse(officialEngine.process(officialTemplate,
          new Context(Locale.CHINA, variables)));
      Element comparable = one(doc, "section.shop-order").clone();
      // This theme adds download so its PJAX click handler leaves attachments to
      // the browser. Keep that intentional adaptation out of upstream equality;
      // the paid-digital assertions below require it on the exact download route.
      comparable.select("a[download][href^=/shop/order/][href$=/download]").removeAttr("download");
      equal(comparable.outerHtml(),
          one(official, "section.shop-order").outerHtml(), name + " official rendered fragment");
    }
    checks.accept(doc);
    passed++;
    System.out.println("PASS " + name);
  }
  static void noActions(Document doc) {
    equal(doc.select(".shop-order-header__actions form, .shop-order-header__actions .shop-btn-primary").size(),
        0, "server capability flags suppress payment and cancellation");
  }

  public static void main(String[] args) {
    Path repository = Path.of(args.length > 0 ? args[0] : ".");
    engine = engine(repository.resolve("templates"));
    if (args.length > 1) {
      Path official = Path.of(args[1]).toAbsolutePath();
      officialEngine = engine(official.getParent());
      officialTemplate = official.getFileName().toString().replaceFirst("\\.html$", "");
    }
    TimeZone previousTimeZone = TimeZone.getDefault();
    TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
    try {
      for (int mode = 0; mode < 3; mode++) {
        final int state = mode;
        List<String> sent = mode == 0 ? null : mode == 1 ? List.of() : List.of("true");
        run("locked-parameter-" + mode, model(null, true, false, false, false, null, sent), doc -> {
          equal(doc.select(".shop-order__grid").size(), 0, "locked response does not evaluate missing order");
          equal(one(doc, "form").attr("action"), "/shop/order/" + ORDER_CODE + "/access-link", "recovery route");
          equal(doc.select("input[type=email][name=email][required]").size(), 1, "required recovery email");
          equal(doc.select(".shop-order-locked__sent").size(), state == 2 ? 1 : 0, "sent confirmation");
          equal(doc.select("a[download], .shop-order-header__actions").size(), 0, "locked has no fulfillment/actions");
        });
      }

      run("pending-guest", model(new Order227(), false, false, true, true, List.of(), null), doc -> {
        equal(one(doc, ".shop-order-header__date").text(), "下单时间：2026-10-14 17:00", "server timezone formatting");
        equal(one(doc, ".shop-order-header__actions a").attr("href"), "/shop/order/" + ORDER_CODE + "/payments", "guest pay route");
        Element cancel = one(doc, ".shop-order-header__actions form");
        equal(cancel.attr("action"), "/shop/order/" + ORDER_CODE + "/cancel", "native cancel route");
        equal(cancel.attr("onsubmit"), "return confirm('确定取消这笔未支付的订单吗？');", "explicit cancel confirmation");
        equal(one(doc, ".shop-order-item__name").attr("href"), "/shop/product/fixture-alias", "item permalink");
        equal(doc.select("a[href^=/uc/]").size(), 0, "guest has no account link");
        equal(one(doc, ".shop-order-header__amount-value").text(), "¥90.00", "payable amount");
        equal(doc.select(".shop-order-summary__row--discount").size(), 2, "discount and coupon rows");
        equal(doc.select("a[download]").size(), 0, "pending empty fulfillment has no downloads");
      });

      run("pending-without-capabilities", model(new Order227(), false, true, false, false, List.of(), null), doc -> {
        noActions(doc);
        equal(one(doc, ".shop-order-header__actions a").attr("href"), "/uc/shop/orders/" + ORDER_CODE, "signed-in account link");
      });

      Order227 physical = paid();
      physical.shippingAddress = new Address227("浙江", "杭州", null, "测试街道", "测", "试", "00000000000");
      var shipping = new Fulfillment227(FulfillmentType.SHIPPING, FulfillmentStatus.SHIPPED,
          List.of(new Label227("承运商", "TRACK-1", "https://tracking.example.test/1"),
              new Label227("线下配送", "TRACK-2", null)),
          List.of(new FulfillmentItem227(item(), "签收前请检查", null, null)));
      run("paid-physical", model(physical, false, true, false, false, List.of(shipping), null), doc -> {
        noActions(doc);
        equal(doc.select(".shop-order-header__badges").text(), "已支付", "paid badge");
        equal(one(doc, ".shop-order-address__line").text(), "浙江 杭州 测试街道", "nullable district");
        equal(one(doc, ".shop-order-address__contact").text(), "测试　00000000000", "recipient");
        Element tracking = one(doc, "a.shop-order-fulfillment__tracking");
        equal(tracking.attr("target"), "_blank", "tracking opens natively");
        equal(tracking.attr("rel"), "noopener noreferrer", "tracking isolation");
        equal(doc.select("span.shop-order-fulfillment__tracking").text(), "TRACK-2", "no fake tracking URL");
        equal(doc.select("a[download]").size(), 0, "physical fulfillment no downloads");
        equal(doc.select(".shop-order-fulfillment__instructions").text(), "签收前请检查", "instructions");
      });

      Order227 digital = paid();
      digital.customerNotes = TEXT;
      digital.items = List.of(new OrderItem227(TEXT, null, null,
          Map.of("planName", "测试计划", "billingPeriod", "MONTHLY"),
          new BigDecimal("100.00"), 1, new BigDecimal("100.00")));
      var digitalFulfillment = new Fulfillment227(FulfillmentType.VIRTUAL, FulfillmentStatus.COMPLETED, List.of(),
          List.of(new FulfillmentItem227(digital.items.getFirst(), TEXT,
              List.of(new Resource227(ResourceType.ATTACHMENT, "resource-public-id", "下载 & 文件", null, "private-attachment-id"),
                  new Resource227(ResourceType.STATIC_URL, "url-public-id", "外部资源", "https://resource.example.test/file?a=1&b=2", null)),
              List.of(new Cdk227(TEXT, "fixture-secret<&"), new Cdk227("fixture-code-only", null)))));
      run("paid-digital", model(digital, false, false, false, false, List.of(digitalFulfillment), null), doc -> {
        noActions(doc);
        equal(doc.select(".shop-order-item__name").text(), TEXT, "escaped item title");
        equal(doc.select("a.shop-order-item__name, .shop-order-item__image:not(div)").size(), 0, "missing item URL/image");
        equal(doc.select(".shop-product-card__badge").text(), "订阅", "subscription snapshot");
        equal(doc.select(".shop-order-header__notes span").text(), TEXT, "escaped customer notes");
        equal(doc.select(".shop-order-fulfillment__instructions").text(), TEXT, "escaped instructions");
        Element download = one(doc, "a[download]");
        equal(download.attr("href"), "/shop/order/" + ORDER_CODE + "/digital-resources/resource-public-id/download", "authorized download route uses public resource ID");
        equal(download.hasAttr("target"), false, "download remains a native download link");
        equal(doc.outerHtml().contains("private-attachment-id"), false, "internal attachment ID never enters markup");
        Element external = one(doc, "a.shop-order-fulfillment__resource[target=_blank]");
        equal(external.attr("href"), "https://resource.example.test/file?a=1&b=2", "static resource URL");
        equal(external.attr("rel"), "noopener noreferrer", "external resource isolation");
        equal(doc.select(".shop-order-fulfillment__cdk-code").size(), 2, "CDK count");
        equal(doc.select(".shop-order-fulfillment__cdk-secret").text(), "fixture-secret<&", "nullable escaped CDK secret");
        equal(doc.select(".shop-order-address__line, form").size(), 0, "digital order has no shipping or write form");
      });
      run("locked-hides-populated-order", model(digital, true, true, true, true, List.of(digitalFulfillment), null), doc -> {
        equal(doc.select(".shop-order__grid, a, code").size(), 0, "locked hides even populated order and fulfillment data");
        equal(doc.outerHtml().contains("fixture-secret"), false, "locked hides synthetic fulfillment secret");
      });

      Order227 minimal = paid();
      minimal.createdAt = null; minimal.refundStatus = null; minimal.items = List.of();
      minimal.subtotalAmount = null; minimal.shippingAmount = null; minimal.discountAmount = null;
      minimal.discountName = null; minimal.couponDiscountAmount = null; minimal.paidAmount = null;
      run("nullable-optionals", model(minimal, false, false, false, false, List.of(), null), doc -> {
        noActions(doc);
        equal(doc.select(".shop-order-summary__row").size(), 1, "only required payable total remains");
        equal(doc.select(".shop-order-header__date, .shop-order-header__notes, .shop-order-item").size(), 0, "nullable metadata omitted");
      });

      var paymentLabels = Map.of(PaymentStatus.AUTHORIZING, "支付确认中", PaymentStatus.REFUNDED, "已退款",
          PaymentStatus.FAILED, "支付失败", PaymentStatus.EXPIRED, "支付已过期", PaymentStatus.CANCELLED, "已取消");
      for (var entry : paymentLabels.entrySet()) {
        Order227 order = new Order227(); order.paymentStatus = entry.getKey();
        if (entry.getKey() == PaymentStatus.CANCELLED) order.status = OrderStatus.CANCELLED;
        run("payment-" + entry.getKey(), model(order, false, false, false, false, List.of(), null), doc -> {
          noActions(doc);
          equal(doc.select(".shop-order-header__badges").text(), entry.getValue(), "payment/status badge");
        });
      }
      for (RefundStatus refund : List.of(RefundStatus.PARTIAL, RefundStatus.FULL)) {
        Order227 order = paid(); order.status = OrderStatus.ARCHIVED; order.refundStatus = refund;
        run("archived-refund-" + refund, model(order, false, false, false, false, List.of(), null), doc -> {
          noActions(doc);
          equal(doc.select(".shop-order-header__badges").text(),
              "已支付 已完成 " + (refund == RefundStatus.PARTIAL ? "部分退款" : "已全额退款"), "order/refund badges");
        });
      }
      for (var type : List.of(FulfillmentType.PICKUP, FulfillmentType.LOCAL_DELIVERY)) {
        var fulfillment = new Fulfillment227(type, null, null,
            List.of(new FulfillmentItem227(null, null, List.of(), List.of())));
        run("fulfillment-" + type, model(paid(), false, false, false, false, List.of(fulfillment), null), doc -> {
          equal(doc.select(".shop-order-fulfillment__head").text(), type == FulfillmentType.PICKUP ? "门店自提" : "同城配送", "fulfillment type and nullable status");
          equal(doc.select(".shop-order-fulfillment__tracking, .shop-order-fulfillment__resource, .shop-order-fulfillment__cdk").size(), 0, "empty fulfillment optionals");
        });
      }
      System.out.println("passed=" + passed + "; real Thymeleaf/Spring jars with synthetic 2.27 presentation models"
          + (officialEngine == null ? "" : "; equivalent to fixed official release/2.27 except intentional native-download attribute")
          + "; not real 2.27 DTO, authorization, CSRF-server, or browser acceptance");
    } finally {
      TimeZone.setDefault(previousTimeZone);
    }
  }
}
