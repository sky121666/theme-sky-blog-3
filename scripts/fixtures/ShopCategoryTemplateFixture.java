// Run with the matching Halo Thymeleaf, Spring, and jsoup runtime jars:
// java --class-path "$SHOP_TEMPLATE_JAVA_CLASSPATH" scripts/fixtures/ShopCategoryTemplateFixture.java .
// No database or live theme setting is changed by this fixture.
import java.util.*;
import java.nio.file.*;
import org.thymeleaf.context.*;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templateresolver.FileTemplateResolver;
import org.thymeleaf.linkbuilder.StandardLinkBuilder;
import org.springframework.data.domain.*;
import org.jsoup.Jsoup;
import org.thymeleaf.dialect.AbstractDialect;
import org.thymeleaf.dialect.IExpressionObjectDialect;
import org.thymeleaf.expression.IExpressionObjectFactory;

public class ShopCategoryTemplateFixture {
  // Only template presentation states are isolated here; this is not an auth test.
  public static class Authorization {
    final boolean authenticated;
    Authorization(boolean authenticated) { this.authenticated=authenticated; }
    public boolean expression(String value) {
      if (!value.equals("isAuthenticated()")) throw new AssertionError("Unexpected auth expression");
      return authenticated;
    }
  }
  public static class Authentication {
    public String getName(){ return "fixture-private-account-id"; }
  }
  public static class Contributor {
    final String displayName;
    final String avatar;
    Contributor(String displayName,String avatar){ this.displayName=displayName;this.avatar=avatar; }
    public String getName(){ return "fixture-private-account-id"; }
    public String getDisplayName(){ return displayName; }
    public String getAvatar(){ return avatar; }
  }
  public static class ContributorFinder {
    final Contributor contributor;
    final List<String> requests=new ArrayList<>();
    ContributorFinder(Contributor contributor){ this.contributor=contributor; }
    public Contributor getContributor(String name){
      requests.add(name);
      if (!name.equals("fixture-private-account-id")) throw new AssertionError("Contributor lookup must use the authenticated account");
      return contributor;
    }
  }
  static class PresentationSecurityDialect extends AbstractDialect implements IExpressionObjectDialect {
    PresentationSecurityDialect(){ super("Fixture presentation security"); }
    public IExpressionObjectFactory getExpressionObjectFactory(){ return new IExpressionObjectFactory(){
      public Set<String> getAllExpressionObjectNames(){ return Set.of("authorization","authentication"); }
      public Object buildObject(IExpressionContext context,String name){ return name.equals("authentication") ? new Authentication() : new Authorization(Boolean.TRUE.equals(context.getVariable("fixtureAuthenticated"))); }
      public boolean isCacheable(String name){ return true; }
    }; }
  }
  public static class Finder {
    final List<Map<String,Object>> entries;
    final List<Integer> requests = new ArrayList<>();
    Finder(List<Map<String,Object>> entries) { this.entries=entries; }
    public Page<Map<String,Object>> list(Map<String,Object> params) {
      int page = ((Number)params.get("page")).intValue();
      if (!Objects.equals(params.get("size"), 999)) throw new AssertionError("Unexpected finder page size");
      requests.add(page);
      int from = Math.min((page-1)*2,entries.size());
      return new PageImpl<>(entries.subList(from,Math.min(from+2,entries.size())),PageRequest.of(page-1,2),entries.size());
    }
  }
  public static class Products {
    public List<Object> getItems(){ return List.of(); }
    public int getTotalPages(){ return 0; }
    public int getTotal(){ return 0; }
  }
  static Map<String,Object> category(long id, String name, List<Map<String,Object>> children) {
    return Map.of("id",id,"name",name,"description",name+"说明","children",children,"image","");
  }
  static List<String> ids(String html) {
    return Jsoup.parse(html).select("#shop-sidebar a[data-shop-category]").stream().map(e->e.attr("data-shop-category")).filter(s->!s.isEmpty()).toList();
  }
  static void equal(Object got,Object want,String label){ if(!Objects.equals(got,want))throw new AssertionError(label+": "+got+" != "+want); }
  static Context context(Object selected,List<Map<String,Object>> tree,Finder finder,String view) {
    return context(selected,tree,finder,view,null);
  }
  static Context context(Object selected,List<Map<String,Object>> tree,Finder finder,String view,Object appearances) {
    Map<String,Object> vars=new HashMap<>();
    var home=Map.of("hero_product","","hero_image","","hero_title","","hero_description","","featured_products",List.of(),"compact_products",List.of(),"preview_products",List.of());
    Map<String,Object> navigation=new HashMap<>();navigation.put("sidebar_categories",selected);
    if(appearances!=null)navigation.put("category_appearances",appearances);
    vars.put("theme",Map.of("config",Map.of("shop",Map.of("navigation",navigation,"display",Map.of("show_description",true),"home",home))));
    vars.put("categories",tree);vars.put("categoryTree",tree);vars.put("productCategoryFinder",finder);
    vars.put("contributorFinder",new ContributorFinder(null));
    vars.put("scene","products");vars.put("currentCategory","");vars.put("currentKeyword","");vars.put("currentSort","");vars.put("currentView",view);
    Map<String,Object> params=new HashMap<>();params.put("view",List.of(view));for(String key:List.of("keyword","categoryId","sort","page"))params.put(key,null);vars.put("param",params);vars.put("site",Map.of("title","Fixture"));vars.put("productPage",new Products());
    return new Context(Locale.CHINA,vars);
  }
  public static void main(String[] args) throws Exception {
    Path repository=Path.of(args.length>0?args[0]:".").toAbsolutePath();
    Path fixtureTemplates=Files.createTempDirectory("shop-category-template-fixture-");
    Path appTemplates=Files.createDirectories(fixtureTemplates.resolve("modules/shop-app"));
    try(var templates=Files.newDirectoryStream(repository.resolve("templates/modules/shop-app"),"*.html")) {
      for(Path template:templates)Files.copy(template,appTemplates.resolve(template.getFileName()));
    }
    Path shellTemplates=Files.createDirectories(fixtureTemplates.resolve("modules/shell"));
    // The Shop template behavior stays real; unrelated Shell chrome is isolated.
    Files.writeString(shellTemplates.resolve("window-controls.html"),"<div th:fragment=\"trafficLights (maximizable)\"></div>");
    FileTemplateResolver resolver=new FileTemplateResolver();resolver.setPrefix(fixtureTemplates+"/");resolver.setSuffix(".html");resolver.setCacheable(false);
    SpringTemplateEngine engine=new SpringTemplateEngine();engine.setTemplateResolver(resolver);engine.addDialect(new PresentationSecurityDialect());
    engine.setLinkBuilder(new StandardLinkBuilder(){protected String computeContextPath(IExpressionContext context,String base,Map<String,Object> params){return "";}});
    var grandchild=category(3,"孙级",List.of());var child=category(2,"子级",List.of(grandchild));var parent=category(1,"父级",List.of(child));var second=category(4,"另一级",List.of());
    List<Map<String,Object>> tree=List.of(parent,second);Finder finder=new Finder(List.of(parent,child,grandchild,second));
    var anonymousContext=context(List.of(),tree,finder,"all");
    var anonymousContributor=new ContributorFinder(new Contributor("示例用户","/fixture-avatar.png"));
    anonymousContext.setVariable("contributorFinder",anonymousContributor);
    var anonymous=Jsoup.parse(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),anonymousContext));
    equal(anonymous.select(".shop-nav a[href='/uc/shop/orders']").size(),0,"orders belong to account, not merchandise navigation");
    equal(anonymous.select("[data-shop-account-login]").text(),"登录","anonymous account label");
    equal(anonymous.select("[data-shop-account-login]").attr("href"),"/login?redirect_uri=/shop/products","official login return");
    equal(anonymous.select("[data-shop-account-orders], [data-shop-account-menu]").size(),0,"anonymous has no authenticated account control");
    equal(anonymousContributor.requests,List.of(),"anonymous never requests contributor data");
    equal(anonymous.html().contains("fixture-private-account-id"),false,"anonymous HTML has no internal account identifier");
    var avatars=Arrays.asList("/fixture-avatar.png","",null);
    var signedInFixtures=new ArrayList<org.jsoup.nodes.Document>();
    for(String avatar:avatars) {
      var signedInContext=context(List.of(),tree,finder,"all");signedInContext.setVariable("fixtureAuthenticated",true);
      var contributors=new ContributorFinder(new Contributor("示例用户",avatar));signedInContext.setVariable("contributorFinder",contributors);
      var signedIn=Jsoup.parse(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),signedInContext));
      assertAccount(signedIn,"示例用户",avatar==null?"":avatar);
      equal(contributors.requests,List.of("fixture-private-account-id"),"authenticated contributor requested once");
      signedInFixtures.add(signedIn);
    }
    for(String displayName:Arrays.asList("","   ",null)) {
      var signedInContext=context(List.of(),tree,finder,"all");signedInContext.setVariable("fixtureAuthenticated",true);
      signedInContext.setVariable("contributorFinder",new ContributorFinder(new Contributor(displayName,"")));
      assertAccount(Jsoup.parse(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),signedInContext)),"我的账户","");
    }
    var missingContext=context(List.of(),tree,finder,"all");missingContext.setVariable("fixtureAuthenticated",true);
    var missingContributor=new ContributorFinder(null);missingContext.setVariable("contributorFinder",missingContributor);
    assertAccount(Jsoup.parse(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),missingContext)),"我的账户","");
    equal(missingContributor.requests,List.of("fixture-private-account-id"),"missing contributor keeps authenticated orders entry");
    var noFinderContext=context(List.of(),tree,finder,"all");noFinderContext.setVariable("fixtureAuthenticated",true);noFinderContext.setVariable("contributorFinder",null);
    assertAccount(Jsoup.parse(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),noFinderContext)),"我的账户","");
    for(String invalidAvatar:List.of("javascript:alert(1)","data:image/png;base64,AAAA","ftp://fixture.test/avatar.png","relative-avatar.png","//outside.test/avatar.png")) {
      var invalidContext=context(List.of(),tree,finder,"all");invalidContext.setVariable("fixtureAuthenticated",true);
      invalidContext.setVariable("contributorFinder",new ContributorFinder(new Contributor("示例用户",invalidAvatar)));
      var invalid=Jsoup.parse(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),invalidContext));
      assertAccount(invalid,"示例用户","");
      equal(invalid.html().contains(invalidAvatar),false,"unsupported avatar scheme stays out of HTML");
    }
    for(String acceptedAvatar:List.of("https://fixture.test/avatar.png","http://fixture.test/avatar.png")) {
      var acceptedContext=context(List.of(),tree,finder,"all");acceptedContext.setVariable("fixtureAuthenticated",true);
      acceptedContext.setVariable("contributorFinder",new ContributorFinder(new Contributor("示例用户",acceptedAvatar)));
      assertAccount(Jsoup.parse(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),acceptedContext)),"示例用户",acceptedAvatar);
    }
    var escapedContext=context(List.of(),tree,finder,"all");escapedContext.setVariable("fixtureAuthenticated",true);
    escapedContext.setVariable("contributorFinder",new ContributorFinder(new Contributor("示例 <img src=x onerror=alert(1)> & \"用户\"","/fixture-avatar.png?label=\" onerror=\"alert(1)&ok=1")));
    var escaped=Jsoup.parse(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),escapedContext));
    assertAccount(escaped,"示例 <img src=x onerror=alert(1)> & \"用户\"","/fixture-avatar.png?label=\" onerror=\"alert(1)&ok=1");
    equal(escaped.select(".shop-sidebar-footer img").size(),1,"display name is text rather than injected markup");
    equal(escaped.select(".shop-sidebar-footer [onerror]").size(),0,"avatar attributes escape quotes");
    if(args.length>1) {
      Path evidence=Files.createDirectories(Path.of(args[1]));
      Files.writeString(evidence.resolve("account-anonymous.html"),anonymous.selectFirst(".shop-sidebar-footer").outerHtml());
      Files.writeString(evidence.resolve("account-authenticated-avatar.html"),signedInFixtures.get(0).selectFirst(".shop-sidebar-footer").outerHtml());
      Files.writeString(evidence.resolve("account-authenticated-no-avatar.html"),signedInFixtures.get(1).selectFirst(".shop-sidebar-footer").outerHtml());
    }
    equal(ids(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),context(List.of(),tree,finder,"all"))),List.of(),"empty config");
    equal(finder.requests,List.of(),"empty config avoids finder");
    for(Object config:Arrays.asList(null,"1",4,Map.of("id",1))) {
      equal(ids(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),context(config,null,finder,"all"))),List.of(),"missing or malformed selection avoids category links");
      equal(finder.requests,List.of(),"missing or malformed selection avoids finder");
    }
    var selected=List.of(" 4 ",Map.of("id",3),2,Map.of("name","1"),Map.of("value","not-found"));
    equal(ids(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),context(selected,tree,finder,"all"))),List.of("4","3","2","1"),"selected tree order and nested IDs");
    equal(finder.requests,List.of(),"products reuses tree");
    equal(ids(engine.process("modules/shop-app/sidebar",Set.of("sidebar"),context(selected,null,finder,"all"))),List.of("4","3","2","1"),"cold page selected order");
    equal(finder.requests,List.of(1,2,2,2),"cold finder scans missing IDs through later pages");
    String categories=engine.process("modules/shop-app/products",Set.of("content"),context(List.of(),tree,new Finder(List.of()),"categories"));
    var doc=Jsoup.parse(categories);equal(doc.select("main a[data-shop-category]").eachAttr("data-shop-category"),List.of("1","2","3","4"),"complete overview tree");
    equal(doc.select("main .shop-category-link[title]").size(),4,"overview descriptions stay in native title hints");
    equal(doc.select("main .shop-category-description").size(),0,"category rows only display names");
    equal(doc.select(".shop-category-overview > .shop-category-tree").attr("style"),"--shop-category-rows-wide:1;--shop-category-rows-medium:1;","two roots use one row at each desktop breakpoint");
    List<Map<String,Object>> many=new ArrayList<>();for(int n=1;n<=20;n++)many.add(category(n,"分类"+n,List.of()));
    var manyOverview=Jsoup.parse(engine.process("modules/shop-app/products",Set.of("content"),context(List.of(),many,new Finder(List.of()),"categories")));
    equal(manyOverview.select(".shop-category-overview > .shop-category-tree").attr("style"),"--shop-category-rows-wide:7;--shop-category-rows-medium:10;","twenty roots receive integer column row counts");
    equal(doc.select(".shop-category-tree .shop-category-tree .shop-category-tree").size(),1,"nested hierarchy");
    equal(doc.select("[data-shop-display-controls], [data-shop-filter], [data-shop-catalog], .shop-pagination").size(),0,"overview product controls absent");
    var emptyOverview=Jsoup.parse(engine.process("modules/shop-app/products",Set.of("content"),context(List.of(),null,new Finder(List.of()),"categories")));
    equal(emptyOverview.select("[data-shop-categories-empty]").size(),1,"missing tree category empty state");
    equal(emptyOverview.select("main [data-shop-browse]").attr("data-shop-keyword"),"","empty category link clears keyword");
    for(String view:List.of("","all")) {
      var page=Jsoup.parse(engine.process("modules/shop-app/products",Set.of("content"),context(List.of(),tree,new Finder(List.of()),view)));
      equal(page.select("[data-shop-display-controls]").size(),view.equals("all")?1:0,"display boundary "+view);
    }
    var appearanceRows=List.of(Map.of("category_id","2","icon","palette","color","#aabbcc"),Map.of("category_id","2","icon","code","color","#FFFFFF"));
    var colored=Jsoup.parse(engine.process("modules/shop-app/products",Set.of("content"),context(List.of("2"),tree,new Finder(List.of()),"categories",appearanceRows)));
    equal(colored.select("main [data-shop-category='2'] .shop-category-icon").attr("style"),"--shop-category-color:#aabbcc","content category uses the first matching ID color");
    equal(colored.select("main [data-shop-category='2'] [data-shop-category-glyph]").attr("data-shop-category-glyph"),"palette","nested category uses configured glyph");
    equal(colored.select("#shop-sidebar [data-shop-category='2'] [style]").size(),0,"sidebar never uses category colors");
    equal(colored.select("#shop-sidebar [data-shop-category='2'] [data-shop-category-glyph]").attr("data-shop-category-glyph"),"palette","sidebar uses configured glyph");
    for(Object malformed:Arrays.asList("bad",4,Map.of("icon","palette"),Arrays.asList(null,"bad",Map.of("category_id",2,"icon","<svg onload=alert(1)>","color","red;background:url(https://bad.test)")))) {
      var safe=Jsoup.parse(engine.process("modules/shop-app/products",Set.of("content"),context(List.of(),tree,new Finder(List.of()),"categories",malformed)));
      equal(safe.select("main .shop-category-icon[style]").size(),0,"malformed category color omitted");
      equal(safe.select("main [data-shop-category='2'] [data-shop-category-glyph]").attr("data-shop-category-glyph"),"folder","malformed glyph falls back");
    }
    for(String url:List.of("/upload/category.png","https://cdn.example.test/category.webp","HTTP://cdn.example.test/category.png","javascript:alert(1)","//bad.test/p.png","/\\bad.test/p.png","data:image/svg+xml,test","https://user:pass@bad.test/p.png","https://", "/bad path.png", "/bad\nimage.png")) {
      var withImage=new HashMap<>(second);withImage.put("image",url);
      var imageDoc=Jsoup.parse(engine.process("modules/shop-app/products",Set.of("content"),context(List.of(),List.of(withImage),new Finder(List.of()),"categories",List.of())));
      boolean accepted=url.equals("/upload/category.png")||url.equals("https://cdn.example.test/category.webp")||url.equals("HTTP://cdn.example.test/category.png");
      equal(imageDoc.select(".shop-category-image").size(),accepted?1:0,"category image protocol and character validation: "+url);
      equal(imageDoc.select("main [data-shop-category-glyph='folder']").size(),1,"image keeps fallback glyph");
    }
    if(args.length>1) {
      Path evidence=Files.createDirectories(Path.of(args[1]));
      var imageCategory=new HashMap<>(category(15,"图片优先",List.of()));imageCategory.put("image","/themes/theme-sky-blog-3/assets/images/shop-demo/icons.png");
      var brokenImageCategory=new HashMap<>(category(16,"图片失效回退",List.of()));brokenImageCategory.put("image","/themes/theme-sky-blog-3/assets/images/shop-demo/category-fixture-missing.png");
      var appearanceTree=List.of(category(11,"设计素材",List.of()),category(12,"开发工具",List.of()),category(13,"阅读资料",List.of()),category(14,"默认分类",List.of()),imageCategory,brokenImageCategory);
      var displayRows=List.of(Map.of("category_id","11","icon","palette","color","#8B5CF6"),Map.of("category_id","12","icon","code","color","#D97706"),Map.of("category_id","13","icon","book-open","color","#059669"),Map.of("category_id","15","icon","package","color","#2563EB"),Map.of("category_id","16","icon","camera","color","#DB2777"));
      var appearanceDoc=Jsoup.parse(engine.process("modules/shop-app/products",Set.of("content"),context(List.of("11","12","13"),appearanceTree,new Finder(List.of()),"categories",displayRows)));
      Files.writeString(evidence.resolve("category-appearances.html"),appearanceDoc.selectFirst(".shop-category-overview").outerHtml());
      Files.writeString(evidence.resolve("category-appearances-sidebar.html"),appearanceDoc.selectFirst("#shop-sidebar").outerHtml());
    }
    System.out.println("PASS: real Thymeleaf category appearance fixtures (stable IDs, nested categories, duplicate precedence, sidebar accent, malformed config, unsafe image/color/icon rejection)");
    System.out.println("PASS: real Thymeleaf account fixtures (anonymous has zero contributor requests, authenticated avatar/name, missing avatar/name/contributor, HTML escaping, private identifier absent, direct orders link without menu)");
    System.out.println("PASS: real Thymeleaf category fixtures (empty, order, nested, legacy data, stale IDs, cold paged Finder, overview hierarchy/descriptions/display boundaries)");
  }
  static void assertAccount(org.jsoup.nodes.Document doc,String label,String avatar) {
    equal(doc.select("[data-shop-account-login]").size(),0,"authenticated account replaces login");
    equal(doc.select(".shop-sidebar-footer a").size(),1,"whole account row is one direct link");
    equal(doc.select("a.shop-account-trigger[data-shop-account-orders]").attr("href"),"/uc/shop/orders","authenticated account goes directly to official orders");
    equal(doc.select("[data-shop-account-orders]").text(),label,"account displays public display name or fallback");
    equal(doc.select(".shop-sidebar-footer details, .shop-sidebar-footer summary, [data-shop-account-menu], .shop-account-popup").size(),0,"account never exposes a menu");
    equal(doc.html().contains("fixture-private-account-id"),false,"internal account identifier stays out of HTML");
    equal(doc.select(".shop-account-avatar").size(),avatar.isEmpty()?0:1,"public avatar renders only when present");
    equal(doc.select(".shop-account-picture").size(),1,"account picture keeps a single fixed-size layout slot");
    equal(doc.select(".shop-sidebar-footer .shop-account-icon:not([hidden])").size(),avatar.isEmpty()?1:0,"missing avatar uses the existing user icon");
    if(!avatar.isEmpty()) {
      equal(doc.select("img.shop-account-avatar").attr("src"),avatar,"avatar uses the contributor image URL");
      equal(doc.select("img.shop-account-avatar").hasAttr("alt"),true,"avatar explicitly declares decorative semantics");
      equal(doc.select("img.shop-account-avatar").attr("alt"),"","avatar is decorative beside the display name");
    }
  }
}
