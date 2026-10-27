// Isolated SSR regression using actual Halo runtime classes and typed 2.26 ProductResponse.
// java --class-path "$SHOP_TEMPLATE_JAVA_CLASSPATH" scripts/fixtures/ShopPermalinkTemplateFixture.java .
// Supply the Halo application.jar plus its matching Thymeleaf/Spring/semver/jsoup jars.
// Reads repository templates only; does not start a server or modify a store.
import java.util.*;
import java.math.BigDecimal;
import java.nio.file.*;
import org.jsoup.Jsoup;
import org.thymeleaf.IEngineConfiguration;
import org.thymeleaf.context.*;
import org.thymeleaf.spring6.SpringTemplateEngine;
import org.thymeleaf.templateresolver.FileTemplateResolver;
import org.thymeleaf.templateresolver.StringTemplateResolver;
import org.thymeleaf.templateresource.ITemplateResource;
import org.thymeleaf.templateresource.StringTemplateResource;
import org.thymeleaf.linkbuilder.StandardLinkBuilder;
import org.thymeleaf.dialect.AbstractDialect;
import org.thymeleaf.dialect.IExpressionObjectDialect;
import org.thymeleaf.expression.IExpressionObjectFactory;
import com.github.zafarkhaja.semver.Version;
import run.halo.app.theme.dialect.expression.HaloExpressionObject;
import run.halo.app.ecommerce.model.ProductResponse;

public class ShopPermalinkTemplateFixture {
  public static class Product227 {
    private final String permalink;
    Product227(String permalink) { this.permalink = permalink; }
    public Long getId(){ return 42L; }
    public String getTitle(){ return "商品"; }
    public String getDescription(){ return "说明"; }
    public String getCoverImageUrl(){ return "/upload/fixture.webp"; }
    public String getProductType(){ return "VIRTUAL"; }
    public List<Object> getProductVariants(){ return List.of(); }
    public List<String> getImages(){ return List.of("/upload/fixture.webp"); }
    public BigDecimal getMinPrice(){ return BigDecimal.TEN; }
    public BigDecimal getMaxPrice(){ return BigDecimal.TEN; }
    public BigDecimal getMinOriginalPrice(){ return null; }
    public String getPermalink(){ return permalink; }
  }
  static class VersionDialect extends AbstractDialect implements IExpressionObjectDialect {
    VersionDialect(){ super("Actual Halo version expression"); }
    public IExpressionObjectFactory getExpressionObjectFactory(){ return new IExpressionObjectFactory(){
      public Set<String> getAllExpressionObjectNames(){ return Set.of("halo"); }
      public Object buildObject(IExpressionContext context,String name){
        String version=(String)context.getVariable("fixtureVersion");
        return new HaloExpressionObject(() -> Version.parse(version));
      }
      public boolean isCacheable(String name){ return true; }
    }; }
  }
  static void canonical(SpringTemplateEngine engine, String template, Map<String,Object> vars, String wanted) {
    String html=engine.process("shop/"+template,new Context(Locale.CHINA,vars));
    var links=Jsoup.parse(html).select("link[rel=canonical][href]");
    if(links.size()!=1 || !links.getFirst().attr("href").equals(wanted)) {
      throw new AssertionError(vars.get("fixtureVersion")+" "+template+" canonical got "+links+" expected "+wanted);
    }
    System.out.println("PASS "+vars.get("fixtureVersion")+" "+template+" canonical -> "+wanted);
  }
  static Map<String,Object> pageModel(String version) {
    Map<String,Object> vars=new HashMap<>();
    vars.put("fixtureVersion",version);
    vars.put("site",Map.of("version",version,"title","SSR fixture","logo","/upload/logo.webp"));
    return vars;
  }
  public static void main(String[] args) throws Exception {
    Path repository=Path.of(args[0]).toAbsolutePath();
    FileTemplateResolver resolver=new FileTemplateResolver();
    resolver.setPrefix(repository+"/templates/");resolver.setSuffix(".html");resolver.setCacheable(false);resolver.setOrder(2);
    // Replace only the unrelated shell body. Actual shop page templates and their
    // fragment arguments still execute, including the complete canonical expression.
    String signature=Jsoup.parse(Files.readString(repository.resolve("templates/modules/shell/layout.html")))
      .selectFirst("html").attr("th:fragment");
    if(signature.isEmpty()) throw new AssertionError("Actual shell fragment signature is required");
    StringTemplateResolver shell=new StringTemplateResolver(){
      protected ITemplateResource computeTemplateResource(IEngineConfiguration configuration,String ownerTemplate,
          String template,Map<String,Object> attributes){
        return new StringTemplateResource("<html th:fragment=\""+signature+"\"><head><link rel=\"canonical\" th:href=\"${canonical}\"></head></html>");
      }
    };
    shell.setResolvablePatterns(Set.of("modules/shell/layout"));shell.setOrder(1);shell.setCacheable(false);
    SpringTemplateEngine engine=new SpringTemplateEngine();engine.setTemplateResolvers(Set.of(shell,resolver));engine.addDialect(new VersionDialect());
    engine.setLinkBuilder(new StandardLinkBuilder(){protected String computeContextPath(IExpressionContext context,String base,Map<String,Object> params){return "";}});
    ProductResponse old=ProductResponse.builder().id(42L).title("商品").description("说明").coverImageUrl("/upload/fixture.webp")
      .productVariants(List.of()).images(List.of("/upload/fixture.webp")).minPrice(BigDecimal.TEN).maxPrice(BigDecimal.TEN).build();
    int passed=0;
    for (String version : List.of("2.26.1","2.27.0","2.28.0","3.0.0","0.0.0")) {
      Object item=(version.equals("2.26.1") || version.equals("0.0.0")) ? old : new Product227("/shop/product/studio-suite");
      String wanted=item==old ? "/shop/product/42" : "/shop/product/studio-suite";
      for(String fragment : List.of("catalogCard","compactCard","hero","featured","preview")) {
        String template=fragment.equals("catalogCard")?"products":"home";
        String selector=List.of("hero","featured","preview").contains(fragment)?"configuredCard":fragment;
        Map<String,Object> vars=new HashMap<>();
        vars.put("fixtureVersion",version);vars.put("site",Map.of("version",version));vars.put("item",item);vars.put("variant",fragment);
        vars.put("showDescription",true);vars.put("configured",false);vars.put("soldOut",false);
        vars.put("customTitle","");vars.put("customDescription","");vars.put("promotionImage","");
        String html=engine.process("modules/shop-app/"+template,Set.of(selector),new Context(Locale.CHINA,vars));
        var links=Jsoup.parse(html).select("a[href]");
        if(links.size()!=1 || !links.getFirst().attr("href").equals(wanted)) throw new AssertionError(version+" "+fragment+" got "+links+" expected "+wanted);
        passed++;System.out.println("PASS "+version+" "+fragment+" -> "+wanted);
      }
    }
    for (String version : List.of("2.26.1","2.27.0","2.28.0","3.0.0","0.0.0")) {
      Object product=(version.equals("2.26.1") || version.equals("0.0.0")) ? old : new Product227("/shop/products/studio-suite");
      Map<String,Object> vars=pageModel(version);vars.put("product",product);
      canonical(engine,"product",vars,product==old ? "/shop/product/42" : "/shop/products/studio-suite");
      passed++;
    }
    for(String permalink : Arrays.asList(null,"","/shop/subscription/studio-suite")) {
      Map<String,Object> vars=pageModel("2.27.0");vars.put("product",new Product227(permalink));
      canonical(engine,"product",vars,permalink==null || permalink.isEmpty() ? "/shop/product/42" : permalink);
      passed++;
    }
    for(String version : List.of("2.26.1","2.27.0")) {
      Map<String,Object> vars=pageModel(version);vars.put("context",Map.of("id","fixture-context"));
      canonical(engine,"checkout",vars,"/shop/checkout/fixture-context");passed++;
      vars=pageModel(version);vars.put("orderCode","fixture-order");
      canonical(engine,"payments",vars,"/shop/order/fixture-order/payments");passed++;
    }
    System.out.println("passed="+passed+"; 25 card links + 12 actual page canonical arguments; 2.26 uses actual ProductResponse without permalink and actual HaloExpressionObject; shell body is isolated");
  }
}
