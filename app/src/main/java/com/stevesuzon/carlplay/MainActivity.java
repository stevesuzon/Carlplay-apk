package com.stevesuzon.carlplay;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.view.View;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int LOCATION_REQUEST = 1001;
    private static final String OFFLINE_URL = "file:///android_asset/index.html";
    private WebView webView;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        webView = new WebView(this); setContentView(webView);
        WebSettings s=webView.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true); s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); s.setUseWideViewPort(true); s.setLoadWithOverviewMode(true);
        s.setAllowFileAccess(true); s.setAllowContentAccess(true);
        webView.addJavascriptInterface(new LocalMarketsBridge(), "CarlplayFiles");
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb){
                if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED) cb.invoke(origin,true,false);
                else { requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_REQUEST); cb.invoke(origin,true,false); }
            }
        });
        webView.setWebViewClient(new WebViewClient(){
            private boolean handle(String url){
                if(url==null)return false; String l=url.toLowerCase(); if(l.startsWith("file:")||l.startsWith("about:"))return false;
                try{ Intent i; if(l.startsWith("intent:")) i=Intent.parseUri(url,Intent.URI_INTENT_SCHEME); else i=new Intent(Intent.ACTION_VIEW, Uri.parse(url)); startActivity(i); return true; }
                catch(ActivityNotFoundException e){return true;} catch(Exception e){return true;}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r){return handle(r.getUrl().toString());}
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url){return handle(url);}
        });
        if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_REQUEST);
        if(android.os.Build.VERSION.SDK_INT >= 30 && !Environment.isExternalStorageManager()) {
            try { startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:"+getPackageName()))); } catch(Exception ignored) {}
        }
        webView.loadUrl(OFFLINE_URL);
    }

    private File marketsRoot(){
        File root = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "Carlplay/Marches");
        new File(root,"France").mkdirs(); new File(root,"Belgique").mkdirs();
        return root;
    }

    private class LocalMarketsBridge {
        @JavascriptInterface public String getFolder(){ return marketsRoot().getAbsolutePath(); }
        @JavascriptInterface public String readAll(){
            JSONArray out=new JSONArray(); scan(marketsRoot(),out); return out.toString();
        }
        private void scan(File dir, JSONArray out){
            File[] fs=dir.listFiles(); if(fs==null)return;
            for(File f:fs){ if(f.isDirectory()) scan(f,out); else if(f.getName().toLowerCase().endsWith(".json")){ try{ byte[] b=read(f); JSONObject o=new JSONObject(); o.put("file",f.getName()); o.put("path",f.getAbsolutePath()); o.put("content",new String(b,StandardCharsets.UTF_8)); out.put(o);}catch(Exception ignored){} } }
        }
        private byte[] read(File f) throws Exception { InputStream in=new FileInputStream(f); byte[] b=new byte[(int)f.length()]; int n=0,r; while(n<b.length&&(r=in.read(b,n,b.length-n))>0)n+=r; in.close(); return b; }
    }

    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
}
