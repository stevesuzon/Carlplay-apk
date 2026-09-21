package fr.suzon.couteausuisse.autoradio;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String HOME = "https://carplay-telephone.appli-suzon.workers.dev/";
    private static final String HOST = "carplay-telephone.appli-suzon.workers.dev";
    private static final int REQ_LOCATION = 51;
    private static final int REQ_CAMERA = 52;

    private WebView web;
    private PermissionRequest pendingCameraRequest;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;
    private String nativeDeviceId;
    private SecureResponseCache secureCache;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        nativeDeviceId = buildNativeDeviceId();
        secureCache = new SecureResponseCache(this);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(false);
        s.setGeolocationEnabled(true);
        s.setAllowContentAccess(false);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        String ua = s.getUserAgentString();
        if (ua == null) ua = "";
        if (!ua.contains("CouteauSuisseAutoradio")) {
            s.setUserAgentString(ua + " CouteauSuisseAutoradio/371");
        }

        web.setWebViewClient(new AutoradioClient());
        web.setWebChromeClient(new AutoradioChrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> openExternal(url));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED ||
                 checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED)) {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
            }, REQ_LOCATION);
        }

        if (state == null) web.loadUrl(HOME);
        else web.restoreState(state);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        web.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private String buildNativeDeviceId() {
        String raw = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
        if (raw == null || raw.trim().isEmpty()) raw = "unknown-device";
        return "autoradio-" + sha256(raw + "|couteau-suisse-v5").substring(0, 24);
    }

    private static String sha256(String value) {
        try {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            byte[] b = d.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (byte x : b) out.append(String.format(Locale.US, "%02x", x));
            return out.toString();
        } catch (Exception e) {
            return "00000000000000000000000000000000";
        }
    }

    private void openExternal(String value) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(value));
            startActivity(i);
        } catch (Exception ignored) {
        }
    }

    private boolean shouldStayInside(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        return ("http".equals(scheme) || "https".equals(scheme)) && HOST.equals(host);
    }

    private String autoradioUiScript() {
        String safeId = nativeDeviceId.replace("\\", "\\\\").replace("'", "\\'");
        return "(function(){" +
                "try{localStorage.setItem('carplay_device_type','autoradio');localStorage.setItem('carplay_device_id','" + safeId + "');}catch(e){}" +
                "window.__COUTEAU_AUTORADIO__=true;" +
                "function tune(){" +
                "try{" +
                "document.documentElement.classList.add('autoradio-mode');" +
                "['#directArticle','#directArticleModal','#homeArticleBtn','#housePhotoButton','#simpleHouseOverlay','#addressCreateQuote','#simpleQuoteBtn','#genericQuoteModal','#simpleQuoteOverlay'].forEach(function(q){var e=document.querySelector(q);if(e)e.remove();});" +
                "document.querySelectorAll('.articleTile').forEach(function(e){e.remove();});" +
                "document.querySelectorAll('button,a,.settingRow,.card,.directBtn').forEach(function(e){var t=(e.innerText||'').toUpperCase();if(t.indexOf('MESURER UNE MAISON')>=0||t.indexOf('DEVIS')>=0||t.indexOf('FICHE D’ACHAT')>=0||t.indexOf(\"FICHE D'ACHAT\")>=0||t.indexOf('ENCHÈRE')>=0||t.indexOf('ENCHERE')>=0||t.indexOf('ARTICLE DE TRAVAIL')>=0)e.remove();});" +
                "if(!document.getElementById('autoradio-style-v370')){" +
                "var st=document.createElement('style');st.id='autoradio-style-v370';" +
                "st.textContent='@media (orientation:landscape){html,body{width:100%!important;height:100%!important;overflow:hidden!important}body{margin:0!important}.settings{z-index:1001!important;max-width:520px!important}.settings button,.settingHead,.settingBody button{min-height:58px!important;font-size:18px!important}#autoradioHomeV370{position:fixed!important;z-index:900!important;inset:0!important;width:100vw!important;height:100dvh!important;box-sizing:border-box!important;margin:0!important;padding:9px 12px 11px!important;background:linear-gradient(180deg,#123c78 0%,#0a2853 58%,#071b38 100%)!important;display:grid!important;grid-template-rows:52px 94px minmax(108px,1fr) minmax(108px,1fr)!important;gap:10px!important;overflow:hidden!important}.autoradioTopBar{display:grid!important;grid-template-columns:54px 1fr 54px!important;align-items:center!important;gap:8px!important}.autoradioBrand{display:flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;color:#fff!important;font:950 clamp(20px,2.4vw,31px)/1 Arial!important}.autoradioBrand img{width:43px!important;height:43px!important;border-radius:11px!important;object-fit:cover!important}.autoradioSettings{width:48px!important;height:48px!important;border-radius:50%!important;border:2px solid #91b9e8!important;background:#183f70!important;color:#fff!important;font-size:27px!important;padding:0!important}.autoradioRows{display:contents!important}.autoradioRow2{display:grid!important;grid-template-columns:1fr 1fr!important;gap:10px!important;min-height:0!important}.autoradioRow3{display:grid!important;grid-template-columns:1fr 1fr 1fr!important;gap:10px!important;min-height:0!important}.autoradioTile{position:relative!important;display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:center!important;gap:12px!important;min-height:0!important;height:100%!important;border:0!important;border-radius:19px!important;padding:9px 12px!important;color:#fff!important;text-decoration:none!important;text-align:center!important;font:950 clamp(16px,2vw,25px)/1.06 Arial!important;box-shadow:0 6px 18px #0007!important;overflow:hidden!important;touch-action:manipulation!important}.autoradioTileText{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;min-width:0!important}.autoradioTile small{display:block!important;margin-top:4px!important;font:850 clamp(10px,1vw,13px)/1.1 Arial!important;opacity:.95!important}.autoradioVisual{display:block!important;flex:0 0 auto!important;max-width:34%!important;max-height:74px!important;width:auto!important;height:auto!important;object-fit:contain!important;filter:drop-shadow(0 4px 5px #0008)!important}.autoradioNearby{background:linear-gradient(145deg,#ff9a16,#ef5a00)!important;font-size:clamp(20px,2.5vw,31px)!important}.autoradioNearby .autoradioVisual{max-width:20%!important;max-height:80px!important}.autoradioContest{background:linear-gradient(145deg,#0c8bff,#1350c6)!important}.autoradioMarkets{background:linear-gradient(145deg,#20a75c,#08733c)!important}.autoradioStations{background:linear-gradient(145deg,#7e64ff,#5b3bd2)!important}.autoradioAddress{background:linear-gradient(145deg,#198fe6,#0a65b5)!important}.autoradioReturn{background:linear-gradient(145deg,#25a55a,#0b6d36)!important}.autoradioErase{background:linear-gradient(145deg,#e14a5a,#a82032)!important}.autoradioIconText{font-size:clamp(30px,3.3vw,46px)!important;line-height:1!important;filter:drop-shadow(0 4px 5px #0006)!important}.autoradioStack{display:grid!important;grid-template-rows:1fr 1fr!important;gap:8px!important;min-height:0!important}.autoradioStack .autoradioTile{padding:5px 8px!important;gap:7px!important;font-size:clamp(12px,1.35vw,17px)!important}.autoradioStack .autoradioVisual{max-height:44px!important;max-width:31%!important}.autoradioStack .autoradioIconText{font-size:25px!important}body.homePage #directArticle,body.homePage #directArticleModal,body.homePage #homeArticleBtn,body.homePage .articleTile{display:none!important}}';" +
                "(document.head||document.documentElement).appendChild(st);" +
                "}" +
                "var p=(location.pathname||'/').replace(/\\/+$/,'')||'/';" +
                "if(p==='/'||p==='/index.html'||p==='/index'){" +
                "var old=document.getElementById('autoradioHomeV369');if(old)old.remove();" +
                "if(!document.getElementById('autoradioHomeV370')){" +
                "var box=document.createElement('section');box.id='autoradioHomeV370';" +
                "box.innerHTML='<div class=\"autoradioTopBar\"><span></span><div class=\"autoradioBrand\"><img src=\"/couteau-suisse-192.png?v=370\" alt=\"Couteau Suisse\"><span>COUTEAU SUISSE</span></div><button type=\"button\" class=\"autoradioSettings\" id=\"autoradioSettingsBtn\">⚙</button></div>'+" +
                "'<button type=\"button\" class=\"autoradioTile autoradioNearby\" id=\"autoradioNearbyBtn\"><img class=\"autoradioVisual\" src=\"/master-front-transparent.png?v=370\" alt=\"\"><span class=\"autoradioTileText\">MARCHÉS À MOINS DE 150 KM<small>Depuis votre emplacement enregistré</small></span></button>'+" +
                "'<div class=\"autoradioRow2\"><button type=\"button\" class=\"autoradioTile autoradioContest\" id=\"autoradioContestBtn\"><span class=\"autoradioIconText\">🏆</span><span class=\"autoradioTileText\">CONCOURS<small>Vos points et votre classement</small></span></button><button type=\"button\" class=\"autoradioTile autoradioMarkets\" id=\"autoradioMarketsBtn\"><img class=\"autoradioVisual\" src=\"/master-front-transparent.png?v=370\" alt=\"\"><span class=\"autoradioTileText\">MARCHÉS<small>Foires • Noël • Brocantes</small></span></button></div>'+" +
                "'<div class=\"autoradioRow3\"><button type=\"button\" class=\"autoradioTile autoradioStations\" id=\"autoradioStationsBtn\"><span class=\"autoradioIconText\">⛽</span><span class=\"autoradioTileText\">STATIONS ESSENCE<small>À moins de 15 km</small></span></button><button type=\"button\" class=\"autoradioTile autoradioAddress\" id=\"autoradioAddressBtn\"><img class=\"autoradioVisual\" src=\"/address-button.png?v=370\" alt=\"\"><span class=\"autoradioTileText\">CARNET D’ADRESSES</span></button><div class=\"autoradioStack\"><button type=\"button\" class=\"autoradioTile autoradioReturn\" id=\"autoradioReturnBtn\"><img class=\"autoradioVisual\" src=\"/retourner-place-trafic-2025.png?v=370\" alt=\"\"><span class=\"autoradioTileText\">RETOURNER SUR LA PLACE</span></button><button type=\"button\" class=\"autoradioTile autoradioErase\" id=\"autoradioEraseBtn\"><span class=\"autoradioIconText\">🗑</span><span class=\"autoradioTileText\">EFFACER L’EMPLACEMENT</span></button></div></div>';" +
                "document.body.appendChild(box);" +
                "box.querySelector('#autoradioSettingsBtn').onclick=function(){try{if(typeof window.toggleSettings==='function')window.toggleSettings();else if(typeof toggleSettings==='function')toggleSettings()}catch(e){}};" +
                "box.querySelector('#autoradioNearbyBtn').onclick=function(){location.href='nearby-markets.html?radius=150';};" +
                "box.querySelector('#autoradioContestBtn').onclick=function(){try{if(typeof window.openContest==='function')window.openContest();else{var b=document.getElementById('contactMailButton');if(b)b.click();}}catch(e){var b=document.getElementById('contactMailButton');if(b)b.click();}};" +
                "box.querySelector('#autoradioMarketsBtn').onclick=function(){location.href='choix-marches-final.html';};" +
                "box.querySelector('#autoradioStationsBtn').onclick=function(){location.href='stations-carburant.html';};" +
                "box.querySelector('#autoradioAddressBtn').onclick=function(){if(typeof window.openSavedAddressBook==='function')window.openSavedAddressBook();else{var b=document.getElementById('homeAddressBookBtn');if(b)b.click();}};" +
                "box.querySelector('#autoradioReturnBtn').onclick=function(){if(typeof window.returnPlace==='function')window.returnPlace();};" +
                "box.querySelector('#autoradioEraseBtn').onclick=function(){if(typeof window.clearReturnPlace==='function')window.clearReturnPlace();};" +
                "}" +
                "}" +
                "}catch(e){}" +
                "}" +
                "function autoradioUpdateCheck(force){" +
                "try{var k='autoradio_update_check_v371',last=Number(localStorage.getItem(k)||0),now=Date.now();if(!force&&now-last<18000000)return;localStorage.setItem(k,String(now));fetch('/autoradio-version.json?_='+now,{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){if(!j)return;var old=localStorage.getItem('autoradio_web_revision_v371')||'';var rev=String(j.webRevision||j.versionCode||'');localStorage.setItem('autoradio_web_revision_v371',rev);if(force||(old&&old!==rev)){location.replace('/?autoradio_maj='+now)}}).catch(function(){})}catch(e){}" +
                "}" +
                "window.autoradioForceUpdate=function(){autoradioUpdateCheck(true)};" +
                "if(typeof window.forceAppUpdate==='function')window.forceAppUpdate=window.autoradioForceUpdate;" +
                "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){tune();autoradioUpdateCheck(false)},{once:true});else{tune();autoradioUpdateCheck(false)}" +
                "})();";
    }

    private boolean isFastLocalData(String url) {
        try {
            Uri u = Uri.parse(url);
            if (!HOST.equalsIgnoreCase(u.getHost())) return false;
            String p = u.getPath() == null ? "" : u.getPath();
            return p.startsWith("/market-chunks/")
                    || p.startsWith("/nearby-shards/")
                    || p.startsWith("/special-data/")
                    || p.equals("/traveller-markets-data-v166.js")
                    || p.equals("/api/fuel-stations");
        } catch (Exception ignored) {
            return false;
        }
    }

    private WebResourceResponse localDataResponse(String url) {
        if (secureCache == null || !isFastLocalData(url)) return null;
        final boolean fuel = url.contains("/api/fuel-stations");
        final long freshMs = fuel ? 10L * 60L * 1000L : 5L * 60L * 60L * 1000L;
        final long staleMs = fuel ? 6L * 60L * 60L * 1000L : 7L * 24L * 60L * 60L * 1000L;
        try {
            SecureResponseCache.Entry hot = secureCache.get(url, freshMs, 0);
            if (hot != null) return entryResponse(hot);
        } catch (Exception ignored) {
        }

        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(4500);
            c.setReadTimeout(7000);
            c.setRequestProperty("User-Agent", web.getSettings().getUserAgentString());
            c.setRequestProperty("Accept-Encoding", "identity");
            c.setUseCaches(true);
            int code = c.getResponseCode();
            if (code >= 200 && code < 300) {
                try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    byte[] data = out.toByteArray();
                    String mime = c.getContentType();
                    if (mime == null || mime.trim().isEmpty()) {
                        mime = url.endsWith(".js") ? "application/javascript" : "application/json";
                    }
                    int semi = mime.indexOf(';');
                    if (semi >= 0) mime = mime.substring(0, semi).trim();
                    secureCache.put(url, data, mime);
                    return new WebResourceResponse(mime, "UTF-8", new ByteArrayInputStream(data));
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.disconnect();
        }

        try {
            SecureResponseCache.Entry stale = secureCache.get(url, staleMs, 0);
            if (stale != null) return entryResponse(stale);
        } catch (Exception ignored) {
        }
        return null;
    }

    private WebResourceResponse entryResponse(SecureResponseCache.Entry entry) {
        String mime = entry.mime == null || entry.mime.trim().isEmpty()
                ? "application/octet-stream" : entry.mime;
        return new WebResourceResponse(mime, "UTF-8", new ByteArrayInputStream(entry.data));
    }

    private WebResourceResponse patchedSubscriptionScript(String requestUrl) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(requestUrl).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", web.getSettings().getUserAgentString());
            c.setRequestProperty("Cache-Control", "no-cache");
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                String js = out.toString("UTF-8");
                js = js.replace("function detectedType() { return \"phone\"; }",
                        "function detectedType() { return \"autoradio\"; }");
                js = js.replace("deviceType: \"phone\" })",
                        "deviceType: detectedType() })");
                js = autoradioUiScript() + "\n" + js;
                return new WebResourceResponse(
                        "application/javascript",
                        "UTF-8",
                        new ByteArrayInputStream(js.getBytes(StandardCharsets.UTF_8))
                );
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private class AutoradioClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (shouldStayInside(uri)) return false;
            openExternal(uri.toString());
            return true;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (shouldStayInside(uri)) return false;
            openExternal(url);
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String u = request.getUrl().toString();
            if (u.contains("/subscription-web.js")) {
                WebResourceResponse patched = patchedSubscriptionScript(u);
                if (patched != null) return patched;
            }
            if ("GET".equalsIgnoreCase(request.getMethod())) {
                WebResourceResponse cached = localDataResponse(u);
                if (cached != null) return cached;
            }
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            if (url != null && url.contains("/subscription-web.js")) {
                WebResourceResponse patched = patchedSubscriptionScript(url);
                if (patched != null) return patched;
            }
            if (url != null) {
                WebResourceResponse cached = localDataResponse(url);
                if (cached != null) return cached;
            }
            return super.shouldInterceptRequest(view, url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            view.evaluateJavascript(autoradioUiScript(), null);
        }
    }

    private class AutoradioChrome extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                    (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                     checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED)) {
                callback.invoke(origin, true, false);
            } else {
                pendingGeoOrigin = origin;
                pendingGeoCallback = callback;
                requestPermissions(new String[]{
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                }, REQ_LOCATION);
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                boolean asksCamera = false;
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) asksCamera = true;
                }
                if (!asksCamera || Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
                        checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(request.getResources());
                } else {
                    pendingCameraRequest = request;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                }
            });
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQ_LOCATION && pendingGeoCallback != null) {
            boolean ok = false;
            for (int x : grantResults) if (x == PackageManager.PERMISSION_GRANTED) ok = true;
            pendingGeoCallback.invoke(pendingGeoOrigin, ok, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }

        if (requestCode == REQ_CAMERA && pendingCameraRequest != null) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (ok) pendingCameraRequest.grant(pendingCameraRequest.getResources());
            else pendingCameraRequest.deny();
            pendingCameraRequest = null;
        }
    }
}
