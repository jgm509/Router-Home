.class public Lapp/routerhome/Chrome;
.super Landroid/webkit/WebChromeClient;
.source "Chrome.java"

.field private final act:Lapp/routerhome/MainActivity;

.method public constructor <init>(Lapp/routerhome/MainActivity;)V
    .registers 2
    invoke-direct {p0}, Landroid/webkit/WebChromeClient;-><init>()V
    iput-object p1, p0, Lapp/routerhome/Chrome;->act:Lapp/routerhome/MainActivity;
    return-void
.end method

# <input type="file">: open Android's file picker (any file type; the page checks the name)
.method public onShowFileChooser(Landroid/webkit/WebView;Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z
    .registers 8
    iget-object v0, p0, Lapp/routerhome/Chrome;->act:Lapp/routerhome/MainActivity;
    iget-object v1, v0, Lapp/routerhome/MainActivity;->upload:Landroid/webkit/ValueCallback;
    if-eqz v1, :fresh
    const/4 v2, 0x0
    invoke-interface {v1, v2}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V
    :fresh
    iput-object p2, v0, Lapp/routerhome/MainActivity;->upload:Landroid/webkit/ValueCallback;
    :try_start
    new-instance v1, Landroid/content/Intent;
    const-string v2, "android.intent.action.GET_CONTENT"
    invoke-direct {v1, v2}, Landroid/content/Intent;-><init>(Ljava/lang/String;)V
    const-string v2, "android.intent.category.OPENABLE"
    invoke-virtual {v1, v2}, Landroid/content/Intent;->addCategory(Ljava/lang/String;)Landroid/content/Intent;
    const-string v2, "*/*"
    invoke-virtual {v1, v2}, Landroid/content/Intent;->setType(Ljava/lang/String;)Landroid/content/Intent;
    const/4 v2, 0x1
    invoke-virtual {v0, v1, v2}, Lapp/routerhome/MainActivity;->startActivityForResult(Landroid/content/Intent;I)V
    :try_end
    .catch Landroid/content/ActivityNotFoundException; {:try_start .. :try_end} :nopicker
    const/4 v1, 0x1
    return v1
    :nopicker
    const/4 v1, 0x0
    iput-object v1, v0, Lapp/routerhome/MainActivity;->upload:Landroid/webkit/ValueCallback;
    const/4 v2, 0x0
    return v2
.end method
