package com.stevesuzon.carlplay;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int LOCATION_REQUEST = 1001;
    private static final String OFFLINE_URL = "file:///android_asset/index.html";
    private static final long DAY = 24L * 60L * 60L * 1000L;
    private static final long LICENSE_DAYS = 365L;
    private static final long GRACE_DAYS = 7L;
    private static final String PREFS = "carlplay_license";
    private static final String LOCAL_SECRET = "CP66-365-RENOUVELLEMENT-SUZON-2026";

    private WebView webView;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private SharedPreferences prefs;
    private TextView licenseBadge;
    private FrameLayout root;
    private boolean expiryDialogVisible = false;

    public class AndroidStatus {
        @JavascriptInterface public boolean hasInternet() {
            try {
                Network n = connectivityManager.getActiveNetwork();
                if (n == null) return false;
                NetworkCapabilities c = connectivityManager.getNetworkCapabilities(n);
                return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
            } catch (Exception e) { return false; }
        }
    }

    private void notifyNetwork() {
        if (webView != null) webView.post(() -> webView.evaluateJavascript("if(window.updateNetworkStatus)window.updateNetworkStatus();", null));
    }

    private long effectiveNow() {
        long now = System.currentTimeMillis();
        long last = prefs.getLong("last_seen", now);
        long effective = Math.max(now, last);
        prefs.edit().putLong("last_seen", effective).apply();
        return effective;
    }

    private long licenseStart() {
        long start = prefs.getLong("license_start", 0L);
        if (start == 0L) {
            start = System.currentTimeMillis();
            prefs.edit().putLong("license_start", start).putLong("last_seen", start).apply();
        }
        return start;
    }

    private long daysRemaining(long now) {
        long end = licenseStart() + LICENSE_DAYS * DAY;
        if (now >= end) return 0;
        return (long)Math.ceil((end - now) / (double)DAY);
    }

    private long graceRemaining(long now) {
        long end = licenseStart() + (LICENSE_DAYS + GRACE_DAYS) * DAY;
        if (now >= end) return 0;
        long licenseEnd = licenseStart() + LICENSE_DAYS * DAY;
        if (now < licenseEnd) return GRACE_DAYS;
        return (long)Math.ceil((end - now) / (double)DAY);
    }

    private boolean fullyExpired(long now) {
        return now >= licenseStart() + (LICENSE_DAYS + GRACE_DAYS) * DAY;
    }

    private String sha256(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] b = md.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format(Locale.US, "%02x", x & 0xff));
            return sb.toString();
        } catch (Exception e) { return "0000000000000000"; }
    }

    private String requestCode() {
        String id = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
        if (id == null) id = "unknown";
        int cycle = prefs.getInt("renewal_cycle", 0);
        String h = sha256(id + "|" + cycle + "|" + licenseStart());
        long n;
        try { n = Long.parseUnsignedLong(h.substring(0, 12), 16) % 100000000L; }
        catch (Exception e) { n = 0L; }
        return String.format(Locale.US, "%08d", n);
    }

    private String expectedRenewalCode() {
        int cycle = prefs.getInt("renewal_cycle", 0);
        String h = sha256(LOCAL_SECRET + "|" + requestCode() + "|" + cycle);
        long n;
        try { n = Long.parseUnsignedLong(h.substring(0, 12), 16) % 100000000L; }
        catch (Exception e) { n = 0L; }
        return String.format(Locale.US, "%08d", n);
    }

    private void renew(String entered) {
        if (!expectedRenewalCode().equals(entered.replace(" ", "").trim())) {
            Toast.makeText(this, "Code de renouvellement incorrect", Toast.LENGTH_LONG).show();
            return;
        }
        int nextCycle = prefs.getInt("renewal_cycle", 0) + 1;
        long now = effectiveNow();
        prefs.edit().putLong("license_start", now).putLong("last_seen", now).putInt("renewal_cycle", nextCycle).apply();
        expiryDialogVisible = false;
        webView.setVisibility(View.VISIBLE);
        updateLicenseBadge();
        Toast.makeText(this, "Licence renouvelée pour 365 jours", Toast.LENGTH_LONG).show();
    }

    private void showRenewalDialog(boolean mandatory) {
        if (expiryDialogVisible) return;
        expiryDialogVisible = true;
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setTextSize(24f);
        input.setHint("Code de renouvellement");
        input.setGravity(Gravity.CENTER);
        int pad = (int)(18 * getResources().getDisplayMetrics().density);
        input.setPadding(pad, pad, pad, pad);
        String req = requestCode();
        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle(mandatory ? "Licence expirée" : "Renouveler la licence")
                .setMessage("Contactez votre fournisseur.\n\nCode de demande : " + req + "\n\nCommuniquez ce code pour recevoir votre nouveau code valable 365 jours.")
                .setView(input)
                .setPositiveButton("VALIDER", null);
        if (!mandatory) b.setNegativeButton("FERMER", (d,w) -> expiryDialogVisible = false);
        AlertDialog dialog = b.create();
        dialog.setCancelable(!mandatory);
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> renew(input.getText().toString())));
        dialog.setOnDismissListener(d -> expiryDialogVisible = false);
        dialog.show();
    }

    private void updateLicenseBadge() {
        long now = effectiveNow();
        long days = daysRemaining(now);
        if (days > 0) {
            licenseBadge.setText("LICENCE  •  " + days + " JOURS RESTANTS");
            licenseBadge.setBackgroundColor(Color.argb(210, 5, 72, 120));
            licenseBadge.setOnClickListener(null);
            webView.setVisibility(View.VISIBLE);
        } else if (!fullyExpired(now)) {
            long grace = graceRemaining(now);
            licenseBadge.setText("GRÂCE  •  " + grace + " JOURS  •  CONTACTEZ POUR RENOUVELER");
            licenseBadge.setBackgroundColor(Color.argb(225, 170, 95, 0));
            licenseBadge.setOnClickListener(v -> showRenewalDialog(false));
            webView.setVisibility(View.VISIBLE);
        } else {
            licenseBadge.setText("LICENCE EXPIRÉE  •  RENOUVELLEMENT REQUIS");
            licenseBadge.setBackgroundColor(Color.argb(235, 150, 20, 20));
            licenseBadge.setOnClickListener(v -> showRenewalDialog(true));
            webView.setVisibility(View.INVISIBLE);
            showRenewalDialog(true);
        }
    }

    private void createLicenseBadge() {
        licenseBadge = new TextView(this);
        licenseBadge.setTextColor(Color.WHITE);
        licenseBadge.setTextSize(15f);
        licenseBadge.setTypeface(Typeface.DEFAULT_BOLD);
        licenseBadge.setGravity(Gravity.CENTER_VERTICAL);
        int hp = (int)(12 * getResources().getDisplayMetrics().density);
        int vp = (int)(7 * getResources().getDisplayMetrics().density);
        licenseBadge.setPadding(hp, vp, hp, vp);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.LEFT);
        int m = (int)(8 * getResources().getDisplayMetrics().density);
        lp.setMargins(m, m, m, m);
        root.addView(licenseBadge, lp);
    }

    @SuppressLint({"SetJavaScriptEnabled","AllowFileAccessFromFileURLs"})
    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        licenseStart();
        connectivityManager=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        createLicenseBadge();
        setContentView(root);
        WebSettings s=webView.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true); s.setGeolocationEnabled(true); s.setMediaPlaybackRequiresUserGesture(false); s.setUseWideViewPort(true); s.setLoadWithOverviewMode(true); s.setAllowFileAccess(true); s.setAllowContentAccess(true); s.setAllowFileAccessFromFileURLs(true); s.setAllowUniversalAccessFromFileURLs(true); s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.addJavascriptInterface(new AndroidStatus(),"AndroidStatus");
        webView.setWebChromeClient(new WebChromeClient(){@Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb){if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED) cb.invoke(origin,true,false); else {requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_REQUEST); cb.invoke(origin,true,false);}}});
        webView.setWebViewClient(new WebViewClient(){private boolean handle(String url){if(url==null)return false;String l=url.toLowerCase();if(l.startsWith("file:")||l.startsWith("about:"))return false;try{Intent i=l.startsWith("intent:")?Intent.parseUri(url,Intent.URI_INTENT_SCHEME):new Intent(Intent.ACTION_VIEW,Uri.parse(url));startActivity(i);return true;}catch(ActivityNotFoundException e){return true;}catch(Exception e){return true;}}@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return handle(r.getUrl().toString());}@Override public boolean shouldOverrideUrlLoading(WebView v,String url){return handle(url);}});
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_REQUEST);
        networkCallback=new ConnectivityManager.NetworkCallback(){@Override public void onAvailable(Network n){notifyNetwork();}@Override public void onLost(Network n){notifyNetwork();}@Override public void onCapabilitiesChanged(Network n,NetworkCapabilities c){notifyNetwork();}};
        try{connectivityManager.registerDefaultNetworkCallback(networkCallback);}catch(Exception ignored){}
        webView.loadUrl(OFFLINE_URL);
        updateLicenseBadge();
    }

    @Override protected void onResume(){super.onResume();if(licenseBadge!=null)updateLicenseBadge();}
    @Override protected void onDestroy(){try{if(connectivityManager!=null&&networkCallback!=null)connectivityManager.unregisterNetworkCallback(networkCallback);}catch(Exception ignored){}super.onDestroy();}
    @Override public void onBackPressed(){if(fullyExpired(effectiveNow())){showRenewalDialog(true);return;}if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
}
