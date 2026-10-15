.class public Lapp/routerhome/Client;
.super Landroid/webkit/WebViewClient;
.source "Client.java"

.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Landroid/webkit/WebViewClient;-><init>()V
    return-void
.end method

# Router pages (private addresses, *.lan) stay in the app; anything else opens in the browser.
.method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Z
    .registers 7
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;
    move-result-object v0
    invoke-virtual {v0}, Landroid/net/Uri;->getScheme()Ljava/lang/String;
    move-result-object v1
    const-string v2, "file"
    invoke-virtual {v2, v1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v2
    if-nez v2, :stay
    invoke-virtual {v0}, Landroid/net/Uri;->getHost()Ljava/lang/String;
    move-result-object v1
    if-eqz v1, :stay
    const-string v2, "(192\\.168\\..*|10\\..*|172\\.(1[6-9]|2[0-9]|3[01])\\..*|100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\..*|.*\\.lan|.*\\.home\\.arpa|localhost|\\[?f[cd][0-9a-f:]*\\]?)"
    invoke-virtual {v1, v2}, Ljava/lang/String;->matches(Ljava/lang/String;)Z
    move-result v2
    if-nez v2, :stay
    :try_start
    new-instance v2, Landroid/content/Intent;
    const-string v3, "android.intent.action.VIEW"
    invoke-direct {v2, v3, v0}, Landroid/content/Intent;-><init>(Ljava/lang/String;Landroid/net/Uri;)V
    const/high16 v3, 0x10000000
    invoke-virtual {v2, v3}, Landroid/content/Intent;->addFlags(I)Landroid/content/Intent;
    invoke-virtual {p1}, Landroid/webkit/WebView;->getContext()Landroid/content/Context;
    move-result-object v3
    invoke-virtual {v3, v2}, Landroid/content/Context;->startActivity(Landroid/content/Intent;)V
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :handled
    :handled
    const/4 v2, 0x1
    return v2
    :stay
    const/4 v2, 0x0
    return v2
.end method

# Router unreachable: show the built-in start page instead of Android's error page.
.method public onReceivedError(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;Landroid/webkit/WebResourceError;)V
    .registers 6
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->isForMainFrame()Z
    move-result v0
    if-eqz v0, :done
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;
    move-result-object v0
    invoke-virtual {v0}, Landroid/net/Uri;->getScheme()Ljava/lang/String;
    move-result-object v0
    const-string v1, "file"
    invoke-virtual {v1, v0}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v0
    if-nez v0, :done
    const-string v0, "file:///android_asset/start.html#offline"
    invoke-virtual {p1, v0}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V
    :done
    return-void
.end method
