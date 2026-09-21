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
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        String ua = s.getUserAgentString();
        if (ua == null) ua = "";
        if (!ua.contains("CouteauSuisseAutoradio")) {
            s.setUserAgentString(ua + " CouteauSuisseAutoradio/382");
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

    private boolean isBlockedMarketVerification(Uri uri) {
        if (uri == null) return false;
        String path = uri.getPath() == null ? "" : uri.getPath().toLowerCase(Locale.ROOT);
        return path.endsWith("/verification-v9.html");
    }

    private String autoradioUiScript() {
        String safeId = nativeDeviceId.replace("\\", "\\\\").replace("'", "\\'");
        return "(function(){" +
                "try{localStorage.setItem('carplay_device_type','autoradio');localStorage.setItem('carplay_device_id','" + safeId + "');}catch(e){}" +
                "window.__COUTEAU_AUTORADIO__=true;" +
                "function loadOnce(id,src){try{if(document.getElementById(id))return;var s=document.createElement('script');s.id=id;s.src=src;s.defer=true;(document.head||document.documentElement).appendChild(s)}catch(_){}}" +
                "function cleanPhoneOnly(){try{document.documentElement.classList.add('autoradio-mode');['#directArticle','#directArticleModal','#homeArticleBtn','#housePhotoButton','#simpleHouseOverlay','#addressCreateQuote','#simpleQuoteBtn','#genericQuoteModal','#simpleQuoteOverlay','#contactMailButton'].forEach(function(q){var e=document.querySelector(q);if(e)e.remove()});document.querySelectorAll('.articleTile').forEach(function(e){e.remove()});document.querySelectorAll('button,a,.settingRow,.card,.directBtn').forEach(function(e){var t=(e.innerText||'').toUpperCase();if(t.indexOf('MESURER UNE MAISON')>=0||t.indexOf('DEVIS')>=0||t.indexOf('FICHE D’ACHAT')>=0||t.indexOf(\"FICHE D'ACHAT\")>=0||t.indexOf('ENCHÈRE')>=0||t.indexOf('ENCHERE')>=0||t.indexOf('ARTICLE DE TRAVAIL')>=0||t.indexOf('CONCOURS')>=0)e.remove()});document.querySelectorAll('a.verify,.verify[href*=verification-v9],a[href*=verification-v9.html]').forEach(function(e){e.remove()})}catch(_){}}" +
                "function showUpdateInfo(text,color){try{var old=document.getElementById('autoradioUpdateV382');if(old)old.remove();var d=document.createElement('div');d.id='autoradioUpdateV382';d.style.cssText='position:fixed;z-index:2147483647;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial';d.innerHTML='<div style=\"width:min(560px,94vw);background:#0b1725;border:4px solid '+(color||'#35d06f')+';border-radius:25px;padding:24px;color:#fff;text-align:center;font:900 21px/1.4 Arial\">'+text+'<br><button id=\"autoradioUpdateCloseV382\" style=\"width:100%;min-height:58px;margin-top:18px;border:0;border-radius:14px;background:#35d06f;color:#07140b;font:950 19px Arial\">FERMER</button></div>';document.body.appendChild(d);d.querySelector('#autoradioUpdateCloseV382').onclick=function(){d.remove()}}catch(_){}}" +
                "function autoradioUpdateCheck(force){try{var k='autoradio_update_check_v382',last=Number(localStorage.getItem(k)||0),now=Date.now();if(!force&&now-last<3600000)return;localStorage.setItem(k,String(now));fetch('/autoradio-version.json?_='+now,{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){if(!j)return;var server=Number(j.versionCode||0),rev=String(j.webRevision||j.versionCode||''),old=localStorage.getItem('autoradio_web_revision_v382')||'';localStorage.setItem('autoradio_web_revision_v382',rev);if(server>382){showUpdateInfo('🔄 UNE NOUVELLE VERSION AUTORADIO EST DISPONIBLE.','#ffd43b');setTimeout(function(){location.href='/download-autoradio.apk?maj='+now},700);return}if(force){showUpdateInfo('✅ COUTEAU SUISSE AUTORADIO EST À JOUR.');location.replace('/?autoradio_maj='+now);return}if(old&&old!==rev)location.replace('/?autoradio_maj='+now)}).catch(function(){if(force)showUpdateInfo('⚠️ Impossible de vérifier la mise à jour. Vérifiez la connexion Internet.','#ff5964')})}catch(_){}}" +
                "loadOnce('autoradio-home-native-v382','/autoradio-home-v382.js?v=382');" +
                "loadOnce('autoradio-subscription-native-v381','/autoradio-subscription-v381.js?v=381');" +
                "cleanPhoneOnly();" +
                "window.autoradioForceUpdate=function(){autoradioUpdateCheck(true)};" +
                "window.forceAppUpdate=window.autoradioForceUpdate;" +
                "autoradioUpdateCheck(false);" +
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
        final long freshMs = fuel ? 10L * 60L * 1000L : 1L * 60L * 60L * 1000L;
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
            if (isBlockedMarketVerification(uri)) {
                view.evaluateJavascript("history.back()", null);
                return true;
            }
            if (shouldStayInside(uri)) return false;
            openExternal(uri.toString());
            return true;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (isBlockedMarketVerification(uri)) {
                view.evaluateJavascript("history.back()", null);
                return true;
            }
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
