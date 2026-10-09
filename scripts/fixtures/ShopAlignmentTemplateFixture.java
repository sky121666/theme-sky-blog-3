// Source-only fixture using the Thymeleaf/Spring/jsoup jars extracted from the
// running Halo Pro 2.26.1 application.jar (SHA256 0ca804362eb6a9def7d19b961e07316d1a5cf7d57ff77e9e155e7ff9c58fd6c6).
// java --class-path "$SHOP_TEMPLATE_JAVA_CLASSPATH" scripts/fixtures/ShopAlignmentTemplateFixture.java .
// The classpath is supplied explicitly; this fixture has no machine-specific default gate.
// ProductFinder's verified contract is Mono<ListResult<ProductResponse>>, not a
// Spring Page. This synchronous double tests the resolved value and pagination;
// Halo's reactive model integration and CSS visibility require separate live QA.
import java.math.BigDecimal;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.thymeleaf.context.*;
import org.thymeleaf.linkbuilder.StandardLinkBuilder;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templateresolver.FileTemplateResolver;

public class ShopAlignmentTemplateFixture {
  public enum Status { PUBLISHED, DRAFT, ARCHIVED }
  public enum ProductType { VIRTUAL, PHYSICAL }
  public enum PricingType { FIXED }

  public static class ListResult {
    final List<Map<String,Object>> items;
    final int page, size, total;
    ListResult(List<Map<String,Object>> items, int page, int size, int total) {
      this.items = items; this.page = page; this.size = size; this.total = total;
    }
    public List<Map<String,Object>> getItems() { return items; }
    public int getPage() { return page; }
    public int getSize() { return size; }
    public int getTotal() { return total; }
    public int getTotalPages() { return (total + size - 1) / size; }
    public boolean hasNext() { return page < getTotalPages(); }
    public boolean hasPrevious() { return page > 1; }
  }

  record CatalogEntry(Map<String,Object> response, boolean deleted) {}
  record Request(int page, int requestedSize, List<String> sort) {}

  public static class Finder {
    final List<Map<String,Object>> published;
    final List<Request> requests = new ArrayList<>();
    Finder(List<CatalogEntry> entries) {
      // The real ProductUcServiceImpl query enforces ProductStatus.PUBLISHED.
      // Deleted resources do not exist in the public catalog supplied here.
      published = entries.stream().filter(e -> !e.deleted() && e.response().get("status") == Status.PUBLISHED)
        .map(CatalogEntry::response).sorted(Comparator.comparingLong(e -> ((Number)e.get("id")).longValue())).toList();
    }
    public ListResult list(Map<String,Object> params) {
      int page = ((Number)params.get("page")).intValue();
      int requestedSize = ((Number)params.get("size")).intValue();
      if (page < 1 || !Set.of(999, 12).contains(requestedSize)) throw new AssertionError("Unexpected Finder pagination: " + params);
      if (!(params.get("sort") instanceof List<?> values)) throw new AssertionError("Finder sort must be a List");
      List<String> sort = values.stream().map(Object::toString).toList();
      equal(sort, requestedSize == 999 ? List.of("id,asc") : List.of("createdAt,desc", "id,desc"), "Finder sort contract");
      requests.add(new Request(page, requestedSize, sort));
      List<Map<String,Object>> ordered = requestedSize == 999 ? published : published.stream()
        .sorted(Comparator.<Map<String,Object>,Instant>comparing(e -> (Instant)e.get("createdAt"))
          .thenComparingLong(e -> ((Number)e.get("id")).longValue()).reversed()).toList();
      // Return two items per page even for size=999, so a tiny fixture exercises
      // later pages without inventing an unsupported get(id) Finder method.
      int from = Math.min((page - 1) * 2, ordered.size());
      return new ListResult(ordered.subList(from, Math.min(from + 2, ordered.size())), page, 2, ordered.size());
    }
  }

  static SpringTemplateEngine engine;
  static int passed;
  static final List<String> failures = new ArrayList<>();

  static Map<String,Object> variant(long id, Boolean tracked, Integer stock, Status status) {
    Map<String,Object> value = new HashMap<>();
    value.put("id", id); value.put("productId", 4L); value.put("specValues", List.of());
    value.put("price", new BigDecimal("19.50")); value.put("originalPrice", new BigDecimal("25.00"));
    value.put("pricingType", PricingType.FIXED); value.put("trackInventory", tracked); value.put("stock", stock);
    value.put("skuCode", "fixture-sku-" + id); value.put("barcode", null); value.put("shippingRequired", false);
    for (String field : List.of("weightG", "lengthMm", "widthMm", "heightMm", "imageUrl")) value.put(field, null);
    value.put("status", status); value.put("createdAt", Instant.parse("2026-10-01T00:00:00Z")); value.put("updatedAt", value.get("createdAt"));
    return value;
  }

  static Map<String,Object> product(long id, String cover, List<Map<String,Object>> variants, Status status) {
    Map<String,Object> value = new HashMap<>();
    value.put("id", id); value.put("handle", "fixture-" + id); value.put("title", "商品 " + id);
    value.put("description", "商品 " + id + " 的短简介"); value.put("coverImageUrl", cover);
    value.put("productType", id == 4 ? ProductType.PHYSICAL : ProductType.VIRTUAL);
    value.put("specDefinition", List.of()); value.put("categoryId", 1L); value.put("status", status);
    value.put("externalLinkUrl", null); value.put("externalLinkButtonText", null);
    value.put("createdAt", Instant.parse("2026-10-01T00:00:00Z")); value.put("updatedAt", value.get("createdAt"));
    value.put("content", "<p>完整详情正文</p>"); value.put("images", cover.isEmpty() ? List.of() : List.of(cover));
    value.put("productVariants", variants); value.put("minPrice", new BigDecimal("19.50"));
    value.put("maxPrice", new BigDecimal("39.00")); value.put("minOriginalPrice", new BigDecimal("49.00"));
    value.put("maxOriginalPrice", new BigDecimal("59.00"));
    return value;
  }

  static List<CatalogEntry> catalog() {
    List<CatalogEntry> entries = new ArrayList<>();
    for (long id : List.of(1L, 2L, 3L, 4L, 5L, 6L, 7L, 9L, 10L, 11L, 12L)) {
      List<Map<String,Object>> variants = switch ((int)id) {
        case 2 -> List.of(variant(20, true, 5, Status.PUBLISHED));
        case 4 -> List.of(variant(40, true, 0, Status.PUBLISHED), variant(41, true, 0, Status.PUBLISHED), variant(42, true, 50, Status.DRAFT));
        case 10 -> List.of(variant(100, false, 0, Status.PUBLISHED));
        case 11 -> List.of(variant(110, true, null, Status.PUBLISHED));
        case 12 -> List.of(variant(120, true, 0, Status.PUBLISHED), variant(121, true, 4, Status.PUBLISHED));
        default -> null;
      };
      Map<String,Object> value = product(id, id == 9 ? "" : "/upload/product-" + id + ".webp", variants, id == 6 ? Status.DRAFT : Status.PUBLISHED);
      if (id == 2) { value.put("minPrice", BigDecimal.ZERO); value.put("maxPrice", BigDecimal.ZERO); value.put("minOriginalPrice", BigDecimal.ZERO); }
      if (id == 3) value.put("maxPrice", new BigDecimal("19.50"));
      entries.add(new CatalogEntry(value, id == 7));
    }
    return entries;
  }

  static Context context(Map<String,Object> home, Finder finder, boolean description) {
    Map<String,Object> vars = new HashMap<>();
    Map<String,Object> configuredHome = new HashMap<>();
    for (String field : List.of("hero_product", "hero_image", "hero_title", "hero_description")) configuredHome.put(field, "");
    for (String field : List.of("featured_products", "compact_products", "preview_products")) configuredHome.put(field, List.of());
    configuredHome.putAll(home);
    vars.put("theme", Map.of("config", Map.of("shop", Map.of("home", configuredHome))));
    vars.put("productFinder", finder); vars.put("showDescription", description);
    vars.put("fallbackPage", new ListResult(List.of(), 1, 2, 0));
    return new Context(Locale.CHINA, vars);
  }
  static Document home(Map<String,Object> config, Finder finder, boolean description) {
    return Jsoup.parse(engine.process("modules/shop-app/home", Set.of("home"), context(config, finder, description)));
  }
  static List<String> ids(Document doc, String selector) { return doc.select(selector).eachAttr("data-shop-home-product"); }
  static List<String> scanPages(Finder finder) { return finder.requests.stream().filter(r -> r.requestedSize() == 999).map(r -> String.valueOf(r.page())).toList(); }
  static String price(Map<String,Object> product) {
    return Jsoup.parse(engine.process("modules/shop-app/products", Set.of("price"), new Context(Locale.CHINA, Map.of("item", product)))).selectFirst(".shop-product-price > span").text();
  }
  static void equal(Object got, Object want, String label) { if (!Objects.equals(got, want)) throw new AssertionError(label + ": " + got + " != " + want); }
  static void truth(boolean got, String label) { if (!got) throw new AssertionError(label); }
  static void run(String label, Runnable action) {
    try { action.run(); passed++; System.out.println("PASS: " + label); }
    catch (Throwable error) {
      failures.add(label);
      Throwable cause = error; while (cause.getCause() != null) cause = cause.getCause();
      System.err.println("FAIL: " + label + " -> " + cause.getClass().getSimpleName() + ": " + cause.getMessage());
    }
  }

  public static void main(String[] args) throws Exception {
    Path repository = Path.of(args.length > 0 ? args[0] : ".").toAbsolutePath();
    Path temporary = Files.createTempDirectory("shop-alignment-template-fixture-");
    try {
      Path app = Files.createDirectories(temporary.resolve("modules/shop-app"));
      for (String name : List.of("home.html", "products.html", "media.html"))
        Files.copy(repository.resolve("templates/modules/shop-app/" + name), app.resolve(name));
      FileTemplateResolver resolver = new FileTemplateResolver(); resolver.setPrefix(temporary + "/"); resolver.setSuffix(".html"); resolver.setCacheable(false);
      engine = new SpringTemplateEngine(); engine.setTemplateResolver(resolver);
      engine.setLinkBuilder(new StandardLinkBuilder() { protected String computeContextPath(IExpressionContext context, String base, Map<String,Object> params) { return ""; } });

      run("empty configuration renders latest compact directory without merchandising scan", () -> {
        Finder finder = new Finder(catalog()); Document doc = home(Map.of(), finder, true);
        equal(doc.select("[data-shop-home-product]").size(), 0, "no automatic merchandising");
        equal(doc.select(".shop-home-featured, .shop-home-compact, .shop-home-preview").size(), 0, "empty modules absent");
        equal(doc.select(".shop-home-fallback-title").text(), "最新商品", "fallback identity");
        equal(doc.select(".shop-home-fallback .shop-compact-card").eachAttr("href"), List.of("/shop/product/12", "/shop/product/11"), "latest compact fallback catalog");
        equal(scanPages(finder), List.of(), "no configured ID scan");
      });
      run("hero resolves a configured later-page ID and preserves the product identity image", () -> {
        Finder finder = new Finder(catalog()); Document doc = home(Map.of("hero_product", "3"), finder, true);
        equal(ids(doc, ".shop-hero"), List.of("3"), "configured hero"); equal(scanPages(finder), List.of("1", "2"), "later page scanned");
        equal(doc.select(".shop-hero-name").text(), "商品 3", "title fallback");
        equal(doc.select(".shop-hero img[data-shop-media=identity]").attr("src"), "/upload/product-3.webp", "identity media");
        equal(doc.select(".shop-hero img[data-shop-media=promotion]").size(), 0, "cover is not a promotion");
      });
      run("featured cards and compact rows preserve configured ID order across pages", () -> {
        Finder finder = new Finder(catalog()); Document doc = home(Map.of("featured_products", List.of("3", "1", "2"), "compact_products", List.of("5", "2"), "preview_products", List.of("3", "1")), finder, true);
        equal(ids(doc, ".shop-home-featured [data-shop-home-product]"), List.of("3", "1"), "two featured cards in configured order");
        equal(ids(doc, ".shop-home-compact [data-shop-home-product]"), List.of("5", "2"), "compact order");
        equal(ids(doc, ".shop-home-preview [data-shop-home-product]"), List.of("3", "1"), "preview order");
        truth(scanPages(finder).contains("3"), "ID beyond the first two pages is found");
      });
      run("missing, deleted and unpublished configured IDs produce no merchandising cards", () -> {
        Finder finder = new Finder(catalog()); Document doc = home(Map.of("hero_product", "6", "featured_products", List.of("7", "404"), "compact_products", List.of("6", "7", "404"), "preview_products", List.of("7", "404")), finder, true);
        equal(doc.select("[data-shop-home-product]").size(), 0, "only public Finder matches render");
        equal(doc.select(".shop-home-fallback .shop-compact-card").size(), 2, "fallback markup remains available");
        equal(Collections.max(finder.requests.stream().filter(r -> r.requestedSize() == 999).map(Request::page).toList()), 5, "scan stops after last public page");
      });
      run("a hero without any image is hidden while compact/featured retain placeholders", () -> {
        Document doc = home(Map.of("hero_product", "9", "featured_products", List.of("9"), "compact_products", List.of("9"), "preview_products", List.of("9")), new Finder(catalog()), true);
        equal(doc.select(".shop-hero").size(), 0, "imageless hero hidden");
        equal(doc.select(".shop-home-featured svg[data-shop-media=identity]").size(), 1, "featured placeholder");
        equal(doc.select(".shop-home-compact svg[data-shop-media=identity]").size(), 1, "compact placeholder");
        equal(doc.select(".shop-home-preview [data-shop-home-product]").size(), 0, "imageless preview hidden");
      });
      run("dedicated promotion image and optional text overrides render without HTML injection", () -> {
        Document doc = home(Map.of("hero_product", "9", "hero_image", "/upload/promotion.webp", "hero_title", "<b>主推</b>", "hero_description", "运营简介"), new Finder(catalog()), true);
        equal(ids(doc, ".shop-hero"), List.of("9"), "promotion permits imageless product hero");
        equal(doc.select(".shop-hero [data-shop-media=promotion]").attr("src"), "/upload/promotion.webp", "dedicated banner");
        equal(doc.select(".shop-hero-name").text(), "<b>主推</b>", "title stays text");
        equal(doc.select(".shop-hero-name b").size(), 0, "no injected markup");
        equal(doc.select(".shop-hero .shop-product-description").text(), "运营简介", "description override");
      });
      run("known sold-out published SKUs skip hero/featured but keep a labelled compact row", () -> {
        Document doc = home(Map.of("hero_product", "4", "featured_products", List.of("4", "2"), "compact_products", List.of("4")), new Finder(catalog()), true);
        equal(doc.select(".shop-hero").size(), 0, "sold-out hero hidden");
        equal(ids(doc, ".shop-home-featured [data-shop-home-product]"), List.of("2"), "draft SKU stock cannot make featured product available");
        equal(ids(doc, ".shop-home-compact [data-shop-home-product]"), List.of("4"), "sold-out row retained");
        equal(doc.select(".shop-home-compact .shop-compact-stock").text(), "暂时缺货", "stock label");
      });
      run("unknown inventory, untracked SKUs and partial stock never fabricate sold-out state", () -> {
        for (String id : List.of("5", "10", "11", "12")) {
          Document doc = home(Map.of("hero_product", id, "featured_products", List.of(id), "compact_products", List.of(id)), new Finder(catalog()), true);
          equal(ids(doc, ".shop-hero"), List.of(id), "hero eligibility " + id);
          equal(ids(doc, ".shop-home-featured [data-shop-home-product]"), List.of(id), "featured eligibility " + id);
          equal(doc.select(".shop-home-compact .shop-compact-stock").size(), 0, "no guessed stock label " + id);
        }
      });
      run("global description switch hides product and promotion descriptions while keeping prices", () -> {
        Document doc = home(Map.of("hero_product", "1", "hero_description", "运营简介", "featured_products", List.of("2", "3"), "compact_products", List.of("5"), "preview_products", List.of("3")), new Finder(catalog()), false);
        equal(doc.select(".shop-product-description").size(), 0, "all short descriptions hidden");
        equal(doc.select("[data-shop-home-product] .shop-product-price").size(), 5, "prices retained");
      });
      run("actual price fragment distinguishes ranges, flat prices, free and missing prices", () -> {
        Map<String,Object> value = product(30, "/upload/30.webp", null, Status.PUBLISHED);
        equal(price(value), "¥19.50 起", "paid range");
        value.put("maxPrice", new BigDecimal("19.50")); equal(price(value), "¥19.50", "flat price");
        value.put("minPrice", BigDecimal.ZERO); value.put("maxPrice", BigDecimal.ZERO); equal(price(value), "免费", "free product");
        value.put("maxPrice", new BigDecimal("9.00")); equal(price(value), "免费起", "free base with paid variant");
        value.put("minPrice", null); equal(price(value), "查看价格", "unknown price");
      });
      run("all-invalid or all-imageless promotion configurations preserve fallback markup", () -> {
        for (Map<String,Object> config : List.of(Map.<String,Object>of("hero_product", "404", "featured_products", List.of("404")), Map.<String,Object>of("hero_product", "9", "preview_products", List.of("9")))) {
          Document doc = home(config, new Finder(catalog()), true);
          equal(doc.select("[data-shop-home-product]").size(), 0, "no valid promotion");
          equal(doc.select(".shop-home-fallback .shop-compact-card").size(), 2, "fallback catalog exists");
        }
        // A configured result ALSO keeps this SSR fallback markup; :has in the
        // real stylesheet hides it. This fixture makes no CSS visibility claim.
        Document configured = home(Map.of("hero_product", "1"), new Finder(catalog()), true);
        equal(configured.select(".shop-home-fallback .shop-compact-card").size(), 2, "constant fallback is not evidence of visibility");
      });
      run("stale promotion image or text alone does not start a product scan", () -> {
        Finder finder = new Finder(catalog()); Document doc = home(Map.of("hero_image", "/upload/old.webp", "hero_title", "旧标题"), finder, true);
        equal(scanPages(finder), List.of(), "no product ID configured"); equal(doc.select(".shop-hero").size(), 0, "no orphaned hero");
      });
      run("fallback rows label stock only when complete published SKU evidence is available", () -> {
        Map<String,Object> soldOut = product(4, "/upload/4.webp", List.of(variant(40, true, 0, Status.PUBLISHED)), Status.PUBLISHED);
        Document doc = home(Map.of(), new Finder(List.of(new CatalogEntry(soldOut, false))), true);
        equal(doc.select(".shop-home-fallback .shop-compact-stock").text(), "暂时缺货", "known fallback stock");
        equal(doc.select(".shop-home-fallback [data-shop-home-product]").size(), 0, "fallback is not merchandising");
      });
      System.out.println("RESULT: " + passed + " passed, " + failures.size() + " failed; real home/price/media Thymeleaf fragments; CSS and reactive host integration excluded.");
      if (!failures.isEmpty()) throw new AssertionError("Failed template cases: " + failures);
    } finally {
      // Remove only this fixture's own temporary copies, never repository data.
      try (var paths = Files.walk(temporary)) { for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path); }
    }
  }
}
