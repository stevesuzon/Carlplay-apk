package fr.suzon.couteausuisse.autoradio;

import android.Manifest;
import android.annotation.SuppressLint;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

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

    private static final int LOADER_BG = Color.rgb(5, 10, 17);

    private FrameLayout root;
    private FrameLayout loadingOverlay;
    private WebView web;
    private boolean firstPageLoaded = false;
    private int loadingGeneration = 0;
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
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

        root = new FrameLayout(this);
        root.setBackgroundColor(LOADER_BG);

        web = new WebView(this);
        web.setBackgroundColor(LOADER_BG);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);
        showLoadingScreen(true);

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
            s.setUserAgentString(ua + " CouteauSuisseAutoradio/384");
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
                "function showUpdateInfo(text,color){try{var old=document.getElementById('autoradioUpdateV384');if(old)old.remove();var d=document.createElement('div');d.id='autoradioUpdateV383';d.style.cssText='position:fixed;z-index:2147483647;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial';d.innerHTML='<div style=\"width:min(560px,94vw);background:#0b1725;border:4px solid '+(color||'#35d06f')+';border-radius:25px;padding:24px;color:#fff;text-align:center;font:900 21px/1.4 Arial\">'+text+'<br><button id=\"autoradioUpdateCloseV384\" style=\"width:100%;min-height:58px;margin-top:18px;border:0;border-radius:14px;background:#35d06f;color:#07140b;font:950 19px Arial\">FERMER</button></div>';document.body.appendChild(d);d.querySelector('#autoradioUpdateCloseV383').onclick=function(){d.remove()}}catch(_){}}" +
                "function autoradioUpdateCheck(force){try{var k='autoradio_update_check_v384',last=Number(localStorage.getItem(k)||0),now=Date.now();if(!force&&now-last<3600000)return;localStorage.setItem(k,String(now));fetch('/autoradio-version.json?_='+now,{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){if(!j)return;var server=Number(j.versionCode||0),rev=String(j.webRevision||j.versionCode||''),old=localStorage.getItem('autoradio_web_revision_v384')||'';localStorage.setItem('autoradio_web_revision_v383',rev);if(server>384){showUpdateInfo('🔄 UNE NOUVELLE VERSION AUTORADIO EST DISPONIBLE.','#ffd43b');setTimeout(function(){location.href='/download-autoradio.apk?maj='+now},700);return}if(force){showUpdateInfo('✅ COUTEAU SUISSE AUTORADIO EST À JOUR.');location.replace('/?autoradio_maj='+now);return}if(old&&old!==rev)location.replace('/?autoradio_maj='+now)}).catch(function(){if(force)showUpdateInfo('⚠️ Impossible de vérifier la mise à jour. Vérifiez la connexion Internet.','#ff5964')})}catch(_){}}" +
                "loadOnce('autoradio-home-native-v384','/autoradio-home-v383.js?v=383-fullbuttons-2');" +
                "loadOnce('autoradio-subscription-native-v381','/autoradio-subscription-v381.js?v=381');" +
                "cleanPhoneOnly();" +
                "window.autoradioForceUpdate=function(){autoradioUpdateCheck(true)};" +
                "window.forceAppUpdate=window.autoradioForceUpdate;" +
                "autoradioUpdateCheck(false);" +
                "})();";
    }


    private int dp(int value) {
        float d = getResources().getDisplayMetrics().density;
        return Math.max(1, Math.round(value * d));
    }

    private GradientDrawable roundedPanel(int color, int strokeColor, int strokeWidthDp, int radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        if (strokeWidthDp > 0) g.setStroke(dp(strokeWidthDp), strokeColor);
        return g;
    }

    private FrameLayout buildLoadingScreen(boolean large) {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setClickable(true);
        overlay.setFocusable(true);
        overlay.setBackgroundColor(large ? LOADER_BG : Color.argb(185, 0, 0, 0));

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        int pad = dp(large ? 22 : 14);
        panel.setPadding(pad, pad, pad, pad);
        if (!large) {
            panel.setBackground(roundedPanel(
                    Color.rgb(8, 18, 31),
                    Color.rgb(245, 164, 36),
                    2,
                    20
            ));
        }

        FrameLayout logoBox = new FrameLayout(this);
        int logoSize = dp(large ? 210 : 82);
        LinearLayout.LayoutParams logoBoxLp = new LinearLayout.LayoutParams(logoSize, logoSize);
        logoBoxLp.bottomMargin = dp(large ? 12 : 7);
        panel.addView(logoBox, logoBoxLp);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.couteau_suisse_logo);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logoBox.addView(logo, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // La serpette est animée séparément : le logo reste stable, seule la lame s'ouvre et se ferme.
        SerpetteView serpette = new SerpetteView(this);
        int serpetteSize = dp(large ? 104 : 48);
        FrameLayout.LayoutParams serpetteLp = new FrameLayout.LayoutParams(serpetteSize, serpetteSize);
        serpetteLp.gravity = Gravity.END | Gravity.BOTTOM;
        serpetteLp.rightMargin = dp(large ? -2 : -1);
        serpetteLp.bottomMargin = dp(large ? 2 : 1);
        logoBox.addView(serpette, serpetteLp);

        TextView title = new TextView(this);
        title.setText("COUTEAU SUISSE");
        title.setTextColor(Color.WHITE);
        title.setTextSize(large ? 30f : 18f);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        panel.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView loading = new TextView(this);
        loading.setText("Chargement…");
        loading.setTextColor(Color.rgb(245, 196, 93));
        loading.setTextSize(large ? 18f : 14f);
        loading.setGravity(Gravity.CENTER);
        loading.setPadding(0, dp(large ? 9 : 5), 0, 0);
        panel.addView(loading, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        FrameLayout.LayoutParams panelLp;
        if (large) {
            panelLp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
        } else {
            panelLp = new FrameLayout.LayoutParams(dp(250), ViewGroup.LayoutParams.WRAP_CONTENT);
        }
        panelLp.gravity = Gravity.CENTER;
        overlay.addView(panel, panelLp);
        return overlay;
    }

    private void showLoadingScreen(boolean large) {
        loadingGeneration++;
        if (root == null) return;
        if (loadingOverlay != null) {
            root.removeView(loadingOverlay);
            loadingOverlay = null;
        }
        loadingOverlay = buildLoadingScreen(large);
        root.addView(loadingOverlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        loadingOverlay.bringToFront();
    }

    private void hideLoadingScreen(int generation) {
        uiHandler.postDelayed(() -> {
            if (generation != loadingGeneration) return;
            if (loadingOverlay != null && root != null) {
                root.removeView(loadingOverlay);
                loadingOverlay = null;
            }
            firstPageLoaded = true;
        }, 280);
    }

    private static class SerpetteView extends View {
        private final Paint handlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint bladePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint bladeEdgePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private ValueAnimator animator;
        private float openAngle = -10f;

        SerpetteView(android.content.Context context) {
            super(context);
            setBackgroundColor(Color.TRANSPARENT);
            handlePaint.setColor(Color.rgb(34, 142, 85));
            handlePaint.setStyle(Paint.Style.FILL);
            bladePaint.setColor(Color.rgb(235, 240, 244));
            bladePaint.setStyle(Paint.Style.FILL);
            bladeEdgePaint.setColor(Color.rgb(80, 96, 108));
            bladeEdgePaint.setStyle(Paint.Style.STROKE);
            bladeEdgePaint.setStrokeWidth(2f);
            textPaint.setColor(Color.WHITE);
            textPaint.setTextAlign(Paint.Align.CENTER);
            textPaint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        }

        @Override
        protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            if (animator != null) animator.cancel();
            animator = ValueAnimator.ofFloat(-10f, -67f);
            animator.setDuration(850);
            animator.setRepeatMode(ValueAnimator.REVERSE);
            animator.setRepeatCount(ValueAnimator.INFINITE);
            animator.setInterpolator(new AccelerateDecelerateInterpolator());
            animator.addUpdateListener(a -> {
                openAngle = (Float) a.getAnimatedValue();
                invalidate();
            });
            animator.start();
        }

        @Override
        protected void onDetachedFromWindow() {
            if (animator != null) animator.cancel();
            animator = null;
            super.onDetachedFromWindow();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float w = getWidth();
            float h = getHeight();
            if (w <= 0 || h <= 0) return;

            float pivotX = w * 0.28f;
            float pivotY = h * 0.76f;

            canvas.drawRoundRect(
                    w * 0.16f, h * 0.68f,
                    w * 0.66f, h * 0.90f,
                    h * 0.08f, h * 0.08f,
                    handlePaint
            );

            textPaint.setTextSize(h * 0.10f);
            canvas.drawText("SS", w * 0.41f, h * 0.825f, textPaint);

            canvas.save();
            canvas.rotate(openAngle, pivotX, pivotY);
            Path blade = new Path();
            blade.moveTo(pivotX, pivotY);
            blade.cubicTo(
                    w * 0.32f, h * 0.51f,
                    w * 0.56f, h * 0.16f,
                    w * 0.88f, h * 0.14f
            );
            blade.cubicTo(
                    w * 0.73f, h * 0.34f,
                    w * 0.50f, h * 0.59f,
                    pivotX, pivotY
            );
            blade.close();
            canvas.drawPath(blade, bladePaint);
            canvas.drawPath(blade, bladeEdgePaint);
            canvas.drawCircle(pivotX, pivotY, h * 0.055f, ColorPaint.WHITE);
            canvas.drawCircle(pivotX, pivotY, h * 0.025f, ColorPaint.DARK);
            canvas.restore();
        }

        private static class ColorPaint {
            static final Paint WHITE = make(Color.WHITE);
            static final Paint DARK = make(Color.rgb(35, 44, 53));
            static Paint make(int color) {
                Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
                p.setColor(color);
                p.setStyle(Paint.Style.FILL);
                return p;
            }
        }
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
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            showLoadingScreen(!firstPageLoaded);
        }

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
            hideLoadingScreen(loadingGeneration);
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
