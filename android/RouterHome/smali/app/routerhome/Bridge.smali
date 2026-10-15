.class public Lapp/routerhome/Bridge;
.super Ljava/lang/Object;
.source "Bridge.java"

# window.RouterHomeApp in the page: save a file (base64) to Downloads.

.field private final ctx:Landroid/content/Context;

.method public constructor <init>(Landroid/content/Context;)V
    .registers 2
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    iput-object p1, p0, Lapp/routerhome/Bridge;->ctx:Landroid/content/Context;
    return-void
.end method

.method public saveFile(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z
    .registers 8
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    :try_start
    const/4 v0, 0x0
    invoke-static {p3, v0}, Landroid/util/Base64;->decode(Ljava/lang/String;I)[B
    move-result-object v0

    new-instance v1, Landroid/content/ContentValues;
    invoke-direct {v1}, Landroid/content/ContentValues;-><init>()V
    const-string v2, "_display_name"
    invoke-virtual {v1, v2, p1}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/String;)V
    const-string v2, "mime_type"
    invoke-virtual {v1, v2, p2}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/String;)V
    const-string v2, "relative_path"
    const-string v3, "Download/"
    invoke-virtual {v1, v2, v3}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/String;)V

    iget-object v2, p0, Lapp/routerhome/Bridge;->ctx:Landroid/content/Context;
    invoke-virtual {v2}, Landroid/content/Context;->getContentResolver()Landroid/content/ContentResolver;
    move-result-object v2
    sget-object v3, Landroid/provider/MediaStore$Downloads;->EXTERNAL_CONTENT_URI:Landroid/net/Uri;
    invoke-virtual {v2, v3, v1}, Landroid/content/ContentResolver;->insert(Landroid/net/Uri;Landroid/content/ContentValues;)Landroid/net/Uri;
    move-result-object v3
    if-eqz v3, :failed
    invoke-virtual {v2, v3}, Landroid/content/ContentResolver;->openOutputStream(Landroid/net/Uri;)Ljava/io/OutputStream;
    move-result-object v1
    invoke-virtual {v1, v0}, Ljava/io/OutputStream;->write([B)V
    invoke-virtual {v1}, Ljava/io/OutputStream;->close()V
    :try_end
    .catch Ljava/lang/Exception; {:try_start .. :try_end} :failed
    const/4 v0, 0x1
    return v0

    :failed
    const/4 v0, 0x0
    return v0
.end method
