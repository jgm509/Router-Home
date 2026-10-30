#
# Router Home: a simple, phone-friendly web interface for OpenWrt.
# Served at http://<router>/home next to LuCI.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=home-ui
PKG_VERSION:=3.1.8
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=Router Home contributors

include $(INCLUDE_DIR)/package.mk

define Package/home-ui
  SECTION:=admin
  CATEGORY:=Administration
  TITLE:=Router Home - simple web interface at /home
  DEPENDS:=+rpcd +rpcd-mod-file +rpcd-mod-iwinfo +rpcd-mod-luci +rpcd-mod-ucode \
	+uhttpd +uhttpd-mod-ubus +cgi-io +jsonfilter +luci-base
  PKGARCH:=all
endef

define Package/home-ui/description
  A simple web interface for everyday tasks: internet status, devices
  (pause, rename, fixed address), WiFi, mobile modem and eSIM profiles,
  DNS, WireGuard and Tailscale, front light, firmware updates and backups.
  LuCI stays available for advanced settings.
endef

define Package/home-ui/conffiles
/etc/config/home-ui
/etc/config/fan
/etc/config/home-ui-light
/etc/config/home-ui-guard
/etc/config/home-ui-iot
endef

define Build/Prepare
endef

define Build/Compile
endef

define Package/home-ui/install
	$(CP) ./files/* $(1)/
	$(INSTALL_DIR) $(1)/usr/share/home-ui/addons
	$(INSTALL_BIN) ./files/usr/libexec/rpcd/home-ui $(1)/usr/libexec/rpcd/home-ui
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/esim-job $(1)/usr/libexec/home-ui/esim-job
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/self-update $(1)/usr/libexec/home-ui/self-update
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/fullbackup $(1)/usr/libexec/home-ui/fullbackup
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/restore-finish $(1)/usr/libexec/home-ui/restore-finish
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/pkg-install $(1)/usr/libexec/home-ui/pkg-install
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/sta160 $(1)/usr/libexec/home-ui/sta160
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/diagnose $(1)/usr/libexec/home-ui/diagnose
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/diag-fix $(1)/usr/libexec/home-ui/diag-fix
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/goodconf $(1)/usr/libexec/home-ui/goodconf
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/sysx $(1)/usr/libexec/home-ui/sysx
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/iot $(1)/usr/libexec/home-ui/iot
	$(INSTALL_BIN) ./files/etc/init.d/home-ui-iot $(1)/etc/init.d/home-ui-iot
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/soft-reset $(1)/usr/libexec/home-ui/soft-reset
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/agh $(1)/usr/libexec/home-ui/agh
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/modem-extra $(1)/usr/libexec/home-ui/modem-extra
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/90-home-ui $(1)/etc/uci-defaults/90-home-ui
	$(INSTALL_DIR) $(1)/etc/hotplug.d/iface
	$(INSTALL_DATA) ./files/etc/hotplug.d/iface/30-home-ui-sta160 $(1)/etc/hotplug.d/iface/30-home-ui-sta160
	$(INSTALL_BIN) ./files/usr/libexec/home-ui/addon $(1)/usr/libexec/home-ui/addon
	$(INSTALL_BIN) ./files/usr/sbin/home-ui-light $(1)/usr/sbin/home-ui-light
	$(INSTALL_BIN) ./files/etc/init.d/home-ui-light $(1)/etc/init.d/home-ui-light
	$(INSTALL_BIN) ./files/usr/sbin/home-ui-fan $(1)/usr/sbin/home-ui-fan
	$(INSTALL_BIN) ./files/usr/sbin/home-ui-fan-gpio $(1)/usr/sbin/home-ui-fan-gpio
	$(INSTALL_BIN) ./files/etc/init.d/home-ui-fan $(1)/etc/init.d/home-ui-fan
	$(INSTALL_BIN) ./files/etc/init.d/home-ui-guard $(1)/etc/init.d/home-ui-guard
endef

define Package/home-ui/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/home-ui-fan enable
	/etc/init.d/home-ui-guard enable; /etc/init.d/home-ui-guard start
	/usr/libexec/home-ui/addon autoinstall
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache
	/etc/init.d/rpcd restart
}
exit 0
endef

$(eval $(call BuildPackage,home-ui))
