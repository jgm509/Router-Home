.class public Lapp/routerhome/MainActivity;
.super Landroid/app/Activity;
.source "MainActivity.java"

# Router Home: shows the router's web app full screen.

.field public web:Landroid/webkit/WebView;
.field public upload:Landroid/webkit/ValueCallback;

.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Landroid/app/Activity;-><init>()V
    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .registers 6
    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    new-instance v0, Landroid/webkit/WebView;
    invoke-direct {v0, p0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V
    iput-object v0, p0, Lapp/routerhome/MainActivity;->web:Landroid/webkit/WebView;

    const v1, -0xf3eae0
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setBackgroundColor(I)V

    invoke-virtual {v0}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;
    move-result-object v1
    const/4 v2, 0x1
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V

    # tell the page it runs inside the app
    invoke-virtual {v1}, Landroid/webkit/WebSettings;->getUserAgentString()Ljava/lang/String;
    move-result-object v2
    new-instance v3, Ljava/lang/StringBuilder;
    invoke-direct {v3}, Ljava/lang/StringBuilder;-><init>()V
    invoke-virtual {v3, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v2, " RouterHomeApp/1.0"
    invoke-virtual {v3, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v3}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v2
    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setUserAgentString(Ljava/lang/String;)V

    new-instance v1, Lapp/routerhome/Client;
    invoke-direct {v1}, Lapp/routerhome/Client;-><init>()V
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V

    new-instance v1, Lapp/routerhome/Chrome;
    invoke-direct {v1, p0}, Lapp/routerhome/Chrome;-><init>(Lapp/routerhome/MainActivity;)V
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebChromeClient(Landroid/webkit/WebChromeClient;)V

    new-instance v1, Lapp/routerhome/Bridge;
    invoke-direct {v1, p0}, Lapp/routerhome/Bridge;-><init>(Landroid/content/Context;)V
    const-string v2, "RouterHomeApp"
    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    invoke-virtual {p0, v0}, Lapp/routerhome/MainActivity;->setContentView(Landroid/view/View;)V

    if-eqz p1, :fresh
    invoke-virtual {v0, p1}, Landroid/webkit/WebView;->restoreState(Landroid/os/Bundle;)Landroid/webkit/WebBackForwardList;
    move-result-object v1
    if-nez v1, :done

    :fresh
    const-string v1, "file:///android_asset/start.html"
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    :done
    return-void
.end method

.method protected onSaveInstanceState(Landroid/os/Bundle;)V
    .registers 3
    iget-object v0, p0, Lapp/routerhome/MainActivity;->web:Landroid/webkit/WebView;
    invoke-virtual {v0, p1}, Landroid/webkit/WebView;->saveState(Landroid/os/Bundle;)Landroid/webkit/WebBackForwardList;
    invoke-super {p0, p1}, Landroid/app/Activity;->onSaveInstanceState(Landroid/os/Bundle;)V
    return-void
.end method

.method public onBackPressed()V
    .registers 2
    iget-object v0, p0, Lapp/routerhome/MainActivity;->web:Landroid/webkit/WebView;
    invoke-virtual {v0}, Landroid/webkit/WebView;->canGoBack()Z
    move-result v0
    if-eqz v0, :leave
    iget-object v0, p0, Lapp/routerhome/MainActivity;->web:Landroid/webkit/WebView;
    invoke-virtual {v0}, Landroid/webkit/WebView;->goBack()V
    return-void
    :leave
    invoke-super {p0}, Landroid/app/Activity;->onBackPressed()V
    return-void
.end method

# result of the file picker opened by <input type="file">
.method protected onActivityResult(IILandroid/content/Intent;)V
    .registers 6
    const/4 v0, 0x1
    if-ne p1, v0, :other
    iget-object v0, p0, Lapp/routerhome/MainActivity;->upload:Landroid/webkit/ValueCallback;
    if-eqz v0, :handled
    invoke-static {p2, p3}, Landroid/webkit/WebChromeClient$FileChooserParams;->parseResult(ILandroid/content/Intent;)[Landroid/net/Uri;
    move-result-object v1
    invoke-interface {v0, v1}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V
    const/4 v1, 0x0
    iput-object v1, p0, Lapp/routerhome/MainActivity;->upload:Landroid/webkit/ValueCallback;
    :handled
    return-void
    :other
    invoke-super {p0, p1, p2, p3}, Landroid/app/Activity;->onActivityResult(IILandroid/content/Intent;)V
    return-void
.end method
