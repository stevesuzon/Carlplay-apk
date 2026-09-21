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

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        nativeDeviceId = buildNativeDeviceId();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        String ua = s.getUserAgentString();
        if (ua == null) ua = "";
        if (!ua.contains("CouteauSuisseAutoradio")) {
            s.setUserAgentString(ua + " CouteauSuisseAutoradio/367");
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
                "try{document.documentElement.classList.add('autoradio-mode');" +
                "if(!document.getElementById('autoradio-style-v368')){" +
                "var st=document.createElement('style');st.id='autoradio-style-v368';" +
                "st.textContent='@media (orientation:landscape){body{font-size:18px!important}.settings{max-width:1200px!important;margin-left:auto!important;margin-right:auto!important}.settings button,.settingHead,.settingBody button{min-height:60px!important;font-size:19px!important}button,a,.card{touch-action:manipulation!important}#autoradioHomeV368{width:min(1180px,96vw);margin:14px auto 28px;padding:8px 0 18px}.autoradioBrand{display:flex;align-items:center;justify-content:center;gap:14px;margin:0 0 16px;font:950 clamp(24px,3vw,38px)/1 Arial;color:#fff}.autoradioBrand img{width:68px;height:68px;border-radius:17px;object-fit:cover}.autoradioRows{display:grid;gap:16px}.autoradioRow2{display:grid;grid-template-columns:1fr 1fr;gap:16px}.autoradioRow3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}.autoradioTile{display:flex!important;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:150px!important;border:0;border-radius:24px;padding:16px;color:#fff!important;text-decoration:none!important;text-align:center;font:950 clamp(19px,2.4vw,30px)/1.08 Arial!important;box-shadow:0 9px 26px #0007;cursor:pointer}.autoradioTile small{font:850 14px/1.1 Arial;opacity:.92}.autoradioMarkets{background:linear-gradient(160deg,#0b76d1,#134c9a)}.autoradioStations{background:linear-gradient(160deg,#c77d00,#7b4700)}.autoradioAddress{background:linear-gradient(160deg,#d46a16,#934006)}.autoradioReturn{background:linear-gradient(160deg,#16964f,#0c5d33)}.autoradioErase{background:linear-gradient(160deg,#c83b45,#7e2029)}.autoradioIcon{font-size:42px;line-height:1}body.homePage #homeDepartmentSearch,body.homePage .homeDesignGrid,body.homePage #fuelStationsQuickBtn,body.homePage #connectedUsersBadge,body.homePage #contactMailButton,body.homePage #housePhotoButton,body.homePage .mailHelpText{display:none!important}body.homePage .top{min-height:50px!important}body.homePage .gear{width:54px!important;height:54px!important;font-size:28px!important;display:flex!important;align-items:center!important;justify-content:center!important}}';" +
                "(document.head||document.documentElement).appendChild(st);}" +
                "['#addressCreateQuote','#simpleQuoteBtn','#genericQuoteModal','#simpleQuoteOverlay'].forEach(function(q){var e=document.querySelector(q);if(e)e.style.display='none';});" +
                "document.querySelectorAll('button,a,.settingRow,.card,.directBtn').forEach(function(e){var t=(e.innerText||'').toUpperCase();if(t.indexOf('DEVIS')>=0||t.indexOf('FICHE D’ACHAT')>=0||t.indexOf(\"FICHE D'ACHAT\")>=0||t.indexOf('ENCHÈRE')>=0||t.indexOf('ENCHERE')>=0)e.style.display='none';});" +
                "var p=(location.pathname||'/').replace(/\\/+$/,'')||'/';" +
                "if(p==='/'||p==='/index.html'||p==='/index'){" +
                "if(!document.getElementById('autoradioHomeV368')){" +
                "var host=document.querySelector('.wrap')||document.body;var top=document.querySelector('.top');var box=document.createElement('section');box.id='autoradioHomeV368';" +
                "box.innerHTML='<div class=\"autoradioBrand\"><img src=\"/couteau-suisse-192.png?v=283\" alt=\"Couteau Suisse\"><span>COUTEAU SUISSE</span></div><div class=\"autoradioRows\"><div class=\"autoradioRow2\"><button type=\"button\" class=\"autoradioTile autoradioMarkets\" id=\"autoradioMarketsBtn\"><span class=\"autoradioIcon\">🧺</span><span>MARCHÉS</span><small>France + Belgique</small></button><button type=\"button\" class=\"autoradioTile autoradioStations\" id=\"autoradioStationsBtn\"><span class=\"autoradioIcon\">⛽</span><span>STATIONS ESSENCE</span><small>À moins de 15 km</small></button></div><div class=\"autoradioRow3\"><button type=\"button\" class=\"autoradioTile autoradioAddress\" id=\"autoradioAddressBtn\"><span class=\"autoradioIcon\">📒</span><span>ADRESSES</span></button><button type=\"button\" class=\"autoradioTile autoradioReturn\" id=\"autoradioReturnBtn\"><span class=\"autoradioIcon\">📍</span><span>RETOURNER SUR LA PLACE</span></button><button type=\"button\" class=\"autoradioTile autoradioErase\" id=\"autoradioEraseBtn\"><span class=\"autoradioIcon\">🗑️</span><span>EFFACER L’EMPLACEMENT</span></button></div></div>';" +
                "if(top&&top.parentNode)top.parentNode.insertBefore(box,top.nextSibling);else host.insertBefore(box,host.firstChild);" +
                "box.querySelector('#autoradioMarketsBtn').onclick=function(){location.href='choix-marches-final.html';};" +
                "box.querySelector('#autoradioStationsBtn').onclick=function(){location.href='stations-carburant.html';};" +
                "box.querySelector('#autoradioAddressBtn').onclick=function(){if(typeof window.openSavedAddressBook==='function')window.openSavedAddressBook();else{var b=document.getElementById('homeAddressBookBtn');if(b)b.click();}};" +
                "box.querySelector('#autoradioReturnBtn').onclick=function(){if(typeof window.returnPlace==='function')window.returnPlace();};" +
                "box.querySelector('#autoradioEraseBtn').onclick=function(){if(typeof window.clearReturnPlace==='function')window.clearReturnPlace();};" +
                "}" +
                "}" +
                "}catch(e){}};" +
                "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tune,{once:true});else tune();" +
                "try{new MutationObserver(function(){tune();}).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}" +
                "})();";
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
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            if (url != null && url.contains("/subscription-web.js")) {
                WebResourceResponse patched = patchedSubscriptionScript(url);
                if (patched != null) return patched;
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
