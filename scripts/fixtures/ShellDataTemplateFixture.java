// java -cp 'output/html-ssr-20261117/java-libs/*' scripts/fixtures/ShellDataTemplateFixture.java .
// Optional second argument: a captured production layout for a before/after comparison.
// Exercises the production Spring/Thymeleaf expressions, with synchronous doubles for
// Halo's resolved Finder results. No network, database, temporary theme or installed plugins.
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;
import org.thymeleaf.context.Context;
import org.thymeleaf.context.IExpressionContext;
import org.thymeleaf.dialect.AbstractDialect;
import org.thymeleaf.dialect.IExpressionObjectDialect;
import org.thymeleaf.expression.IExpressionObjectFactory;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templateresolver.StringTemplateResolver;

public class ShellDataTemplateFixture {
    private static final SpringTemplateEngine ENGINE = new SpringTemplateEngine();
    private static String menuTemplate, iconTemplate;
    private static final List<String> failures = new ArrayList<>();
    private static int passes;

    public static class OldMenuFinder {
        final List<String> singles = new ArrayList<>();
        final List<List<String>> batches = new ArrayList<>();
        public Map<String, Object> getByName(String name) {
            singles.add(name);
            return menu(name);
        }
        // Intentionally no getByNames: unguarded use on 2.26 must fail.
    }

    public static class NewMenuFinder extends OldMenuFinder {
        public List<Map<String, Object>> getByNames(Collection<String> names) {
            batches.add(List.copyOf(names));
            // Halo's 2.27 menu finder emits distinct existing names in input order.
            return names.stream().distinct().map(ShellDataTemplateFixture::menu).toList();
        }
    }

    private static Map<String, Object> menu(String name) {
        return Map.of("metadata", Map.of("name", name), "menuItems", List.of());
    }

    public static class HaloVersion {
        final int minor;
        HaloVersion(int minor) { this.minor = minor; }
        public boolean matchVersion(String requirement) {
            eq(requirement.replace(" ", ""), ">=2.27.0", "menu batch compatibility boundary");
            return minor >= 27;
        }
    }

    private static class HaloDialect extends AbstractDialect implements IExpressionObjectDialect {
        HaloDialect() { super("Halo version fixture"); }
        public IExpressionObjectFactory getExpressionObjectFactory() {
            return new IExpressionObjectFactory() {
                public Set<String> getAllExpressionObjectNames() { return Set.of("halo"); }
                public Object buildObject(IExpressionContext ctx, String name) { return ctx.getVariable("fixtureHalo"); }
                public boolean isCacheable(String name) { return true; }
            };
        }
    }

    public static class ContentFinder {
        final List<String> reads = new ArrayList<>();
        public Map<String, Object> getByName(String id) {
            reads.add(id);
            return id.startsWith("removed-") ? null : item(id);
        }
        // No list API here: a render that adds unrelated page/list reads fails.
    }

    private static Map<String, Object> item(String id) {
        return Map.of("metadata", Map.of("name", id),
                "spec", Map.of("title", "title-" + id, "displayName", "title-" + id, "visible", "PUBLIC"),
                "status", Map.of("permalink", "/current/" + id));
    }

    private static Map<String, Object> page(String... ids) {
        return Map.of("items", Arrays.stream(ids).map(ShellDataTemplateFixture::item).toList());
    }

    private static void eq(Object actual, Object expected, String message) {
        if (!Objects.equals(actual, expected))
            throw new AssertionError(message + ": expected " + expected + ", got " + actual);
    }

    // Neither lookup logic nor icon payload formatting is recreated in the fixture.
    private static String declarations(String layout, String first, String next) {
        int a = layout.indexOf("\n      " + first + " =");
        int b = layout.indexOf("\n      " + next + " =", a + 1);
        if (a < 0 || b <= a) throw new IllegalStateException("Cannot find production th:with boundaries: " + first + " / " + next);
        String result = layout.substring(a, b).strip();
        if (!result.endsWith(",")) throw new IllegalStateException("Unexpected th:with declaration end: " + next);
        return result.substring(0, result.length() - 1);
    }

    private static void loadTemplates(String layout) {
        var menuBindings = declarations(layout, "headerMenuName", "dockShopEnabled");
        menuTemplate = "<div th:with=\"" + menuBindings + "\"><i th:text=\"${headerMenu?.metadata?.name ?: '-'}\"></i>"
                + "<i th:text=\"${dockMenu?.metadata?.name ?: '-'}\"></i></div>";

        int raw = layout.indexOf("const rawIcons = [");
        int start = raw < 0 ? -1 : layout.lastIndexOf("<script", raw);
        int end = raw < 0 ? -1 : layout.indexOf("</script>", raw);
        if (start < 0 || end < 0) throw new IllegalStateException("Missing production rawIcons script");
        var iconConfig = declarations(layout, "desktopCustomIcons", "navigationSource");
        iconTemplate = "<th:block th:with=\"" + iconConfig + "\">"
                + layout.substring(start, end + "</script>".length()) + "</th:block>";
    }

    private static void menuCase(int minor, boolean same, boolean source) {
        OldMenuFinder finder = minor < 27 ? new OldMenuFinder() : new NewMenuFinder();
        String dock = same ? "header-live" : "dock-live";
        var context = new Context(Locale.ROOT, Map.of(
                "fixtureHalo", new HaloVersion(minor == 0 ? 27 : minor), "menuFinder", finder,
                "site", Map.of("version", minor == 0 ? "0.0.0" : "2." + minor + ".0"),
                "navigationHeaderMenuName", "header-live", "legacyHeaderMenuName", "",
                "rawMenuName", dock, "widgetsSourceRequest", source));
        String html = ENGINE.process(menuTemplate, context);
        var values = Pattern.compile("<i>([^<]*)</i>").matcher(html).results().map(r -> r.group(1)).toList();
        eq(values, source ? List.of("-", "-") : List.of("header-live", dock), "resolved header and Dock identities");
        if (source) {
            eq(finder.singles, List.of(), "widget source: no individual menu read");
            eq(finder.batches, List.of(), "widget source: no batched menu read");
        } else if (same) {
            eq(finder.singles.size() + finder.batches.size(), 1, "same menu: one read");
            if (!finder.batches.isEmpty()) eq(finder.batches.getFirst().stream().distinct().toList(), List.of(dock), "one menu name");
        } else {
            eq(finder.singles, List.of("header-live", dock), "distinct menus use the supported per-name API");
            eq(finder.batches, List.of(), "no unnecessary batch/version branch");
        }
    }

    record Icon(String key, String title, String href) {}
    private static final Pattern OUTPUT_ICON = Pattern.compile(
            "\\bkey:\\s*\"([^\"]+)\",\\s*title:\\s*\"([^\"]+)\",\\s*href:\\s*\"([^\"]+)\"");

    private static void iconCase(boolean source, List<String> posts, List<String> pages, Map<String, Object> owner,
                                 List<String> postReads, List<String> pageReads) {
        ContentFinder pf = new ContentFinder(), sf = new ContentFinder();
        var cfg = Map.of("custom_icons", List.of(), "categories", List.of(), "tags", List.of(), "posts", posts, "single_pages", pages);
        var vars = new HashMap<String, Object>(owner);
        vars.put("theme", Map.of("config", Map.of("desktop", Map.of("icons", cfg))));
        vars.put("postFinder", pf); vars.put("singlePageFinder", sf);
        vars.put("widgetsColumns", 12); vars.put("widgetsSourceRequest", source);
        String html = ENGINE.process(iconTemplate, new Context(Locale.ROOT, vars));
        var actual = OUTPUT_ICON.matcher(html).results().map(r -> new Icon(r.group(1), r.group(2), r.group(3).replace("\\/", "/"))).toList();
        var expected = new ArrayList<Icon>();
        if (!source) {
            for (String id : posts) expected.add(expectedIcon("post", id));
            for (String id : pages) expected.add(expectedIcon("page", id));
        }
        eq(actual, expected, "configured order, fresh titles, links and missing-item fallback");
        eq(pf.reads, postReads, "post detail reads");
        eq(sf.reads, pageReads, "independent page detail reads");
    }

    private static Icon expectedIcon(String kind, String id) {
        return id.startsWith("removed-") ? new Icon("icon-" + kind + "-" + id, id, "#")
                : new Icon("icon-" + kind + "-" + id, "title-" + id, "/current/" + id);
    }

    private static void check(String label, Runnable test) {
        try { test.run(); passes++; System.out.println("PASS " + label); }
        catch (AssertionError | RuntimeException e) {
            Throwable cause = e;
            while (cause.getCause() != null) cause = cause.getCause();
            failures.add(label + ": " + cause); System.err.println("FAIL " + failures.getLast());
        }
    }

    public static void main(String[] args) throws Exception {
        Path repo = Path.of(args.length > 0 ? args[0] : ".");
        Path layout = args.length > 1 ? Path.of(args[1]) : repo.resolve("templates/modules/shell/layout.html");
        loadTemplates(Files.readString(layout));
        ENGINE.setTemplateResolver(new StringTemplateResolver()); ENGINE.addDialect(new HaloDialect());
        for (int minor : List.of(26, 27)) {
            check("2." + minor + " distinct menus", () -> menuCase(minor, false, false));
            check("2." + minor + " same menu", () -> menuCase(minor, true, false));
            check("2." + minor + " widgetSource skips menus", () -> menuCase(minor, false, true));
        }
        check("unknown development version uses only legacy menu API", () -> menuCase(0, false, false));

        check("current post may be a preview or have a decorated title: keep the public Finder", () -> iconCase(false, List.of("current"), List.of(),
                Map.of("post", item("current")), List.of("current"), List.of()));
        check("current independent page may be a preview: keep the public Finder", () -> iconCase(false, List.of(), List.of("current-page"),
                Map.of("singlePage", item("current-page")), List.of(), List.of("current-page")));
        check("another route item never replaces a configured icon", () -> iconCase(false,
                List.of("other-post"), List.of("other-page"), Map.of("post", item("current"), "singlePage", item("current-page")),
                List.of("other-post"), List.of("other-page")));
        check("route posts and widget rows preserve configured order", () -> iconCase(false, List.of("z", "b", "a"), List.of(),
                Map.of("posts", page("a", "b", "unselected"), "widgetsLatestPosts", page("z")), List.of(), List.of()));
        check("private route title decoration does not leak into the desktop label", () -> iconCase(false,
                List.of("private"), List.of(), Map.of("posts", Map.of("items", List.of(Map.of(
                        "metadata", Map.of("name", "private"),
                        "spec", Map.of("visible", "PRIVATE", "title", "title-private（私有）"),
                        "status", Map.of("permalink", "/current/private"))))),
                List.of("private"), List.of()));
        check("miss, list-hidden post, missing page: direct lookup fallback", () -> iconCase(false,
                List.of("list-hidden", "hit", "removed-post"), List.of("missing-from-list", "removed-page"),
                Map.of("posts", page("hit")), List.of("list-hidden", "removed-post"), List.of("missing-from-list", "removed-page")));
        check("absent route variables preserve original detail resolution", () -> iconCase(false,
                List.of("p"), List.of("s"), Map.of(), List.of("p"), List.of("s")));
        check("widgetSource skips configured post and page lookups", () -> iconCase(true,
                List.of("p"), List.of("s"), Map.of(), List.of(), List.of()));
        System.out.println(passes + " passed, " + failures.size() + " failed");
        if (!failures.isEmpty()) throw new AssertionError(String.join("\n", failures));
    }
}
