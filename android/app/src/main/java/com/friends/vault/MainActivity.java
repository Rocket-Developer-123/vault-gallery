package com.friends.vault;

import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Blocks screenshots, screen recording and the recent-apps preview
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        // The server checks for this marker when REQUIRE_APP=true
        s.setUserAgentString(s.getUserAgentString() + " VaultApp/1");

        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);
        web.setWebViewClient(new WebViewClient());
        web.loadUrl(getString(R.string.vault_url));
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
