package com.stevesuzon.carlplay;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final int LOCATION_REQUEST = 1001;
    private static final String OFFLINE_URL = "file:///android_asset/index.html";
    private WebView webView;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

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

    @SuppressLint({"SetJavaScriptEnabled","AllowFileAccessFromFileURLs"})
    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        connectivityManager=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        webView = new WebView(this); setContentView(webView);
        WebSettings s=webView.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true); s.setGeolocationEnabled(true); s.setMediaPlaybackRequiresUserGesture(false); s.setUseWideViewPort(true); s.setLoadWithOverviewMode(true); s.setAllowFileAccess(true); s.setAllowContentAccess(true); s.setAllowFileAccessFromFileURLs(true); s.setAllowUniversalAccessFromFileURLs(true); s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.addJavascriptInterface(new AndroidStatus(),"AndroidStatus");
        webView.setWebChromeClient(new WebChromeClient(){@Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb){if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED) cb.invoke(origin,true,false); else {requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_REQUEST); cb.invoke(origin,true,false);}}});
        webView.setWebViewClient(new WebViewClient(){private boolean handle(String url){if(url==null)return false;String l=url.toLowerCase();if(l.startsWith("file:")||l.startsWith("about:"))return false;try{Intent i=l.startsWith("intent:")?Intent.parseUri(url,Intent.URI_INTENT_SCHEME):new Intent(Intent.ACTION_VIEW,Uri.parse(url));startActivity(i);return true;}catch(ActivityNotFoundException e){return true;}catch(Exception e){return true;}}@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return handle(r.getUrl().toString());}@Override public boolean shouldOverrideUrlLoading(WebView v,String url){return handle(url);}});
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_REQUEST);
        networkCallback=new ConnectivityManager.NetworkCallback(){@Override public void onAvailable(Network n){notifyNetwork();}@Override public void onLost(Network n){notifyNetwork();}@Override public void onCapabilitiesChanged(Network n,NetworkCapabilities c){notifyNetwork();}};
        try{connectivityManager.registerDefaultNetworkCallback(networkCallback);}catch(Exception ignored){}
        webView.loadUrl(OFFLINE_URL);
    }
    @Override protected void onDestroy(){try{if(connectivityManager!=null&&networkCallback!=null)connectivityManager.unregisterNetworkCallback(networkCallback);}catch(Exception ignored){}super.onDestroy();}
    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
}
