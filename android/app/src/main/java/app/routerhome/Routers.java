package app.routerhome;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The saved routers. Kept in the app's private storage:
 *   list       JSON array of {id, name, addr, user, sshPort}
 *   pw.<id>    the router's password, encrypted with a key in the Android
 *              keystore (the key can't be read out of the phone)
 *   hk.<id>    the router's SSH host key: {type, key, fp}
 * Deleting a router deletes all three.
 */
final class Routers {
	private static final String ALIAS = "routerhome-passwords";
	private final SharedPreferences sp;

	Routers(Context ctx) {
		sp = ctx.getApplicationContext().getSharedPreferences("routers", Context.MODE_PRIVATE);
	}

	/* ---------------- the list ---------------- */

	synchronized JSONArray all() {
		try {
			return new JSONArray(sp.getString("list", "[]"));
		} catch (JSONException e) {
			return new JSONArray();
		}
	}

	synchronized JSONObject get(String id) {
		JSONArray a = all();
		for (int i = 0; i < a.length(); i++) {
			JSONObject r = a.optJSONObject(i);
			if (r != null && r.optString("id").equals(id)) return r;
		}
		return null;
	}

	/** The list for the routers page: no passwords, only whether one is saved. */
	synchronized JSONArray forPage() {
		JSONArray a = all(), out = new JSONArray();
		for (int i = 0; i < a.length(); i++) {
			JSONObject r = a.optJSONObject(i);
			if (r == null) continue;
			try {
				JSONObject o = new JSONObject(r.toString());
				String id = r.optString("id");
				o.put("hasPassword", sp.contains("pw." + id));
				JSONObject hk = hostKey(id);
				if (hk != null) o.put("hostKey", hk.optString("type") + " " + hk.optString("fp"));
				out.put(o);
			} catch (JSONException ignored) { }
		}
		return out;
	}

	/**
	 * Adds or changes a router. in: {id?, name, addr, user, sshPort, password?, forgetPassword?}.
	 * A missing or empty password keeps the saved one. Returns the router's id.
	 */
	synchronized String save(JSONObject in) throws JSONException {
		String addr = cleanAddr(in.optString("addr"));
		if (addr.isEmpty()) throw new JSONException("no address");
		String id = in.optString("id");
		if (id.isEmpty()) id = UUID.randomUUID().toString();
		String user = in.optString("user").trim();
		int port = in.optInt("sshPort", 22);
		if (port < 1 || port > 65535) port = 22;

		JSONObject r = new JSONObject();
		r.put("id", id);
		r.put("name", in.optString("name").trim().isEmpty() ? addr : in.optString("name").trim());
		r.put("addr", addr);
		r.put("user", user.isEmpty() ? "root" : user);
		r.put("sshPort", port);

		JSONArray a = all(), next = new JSONArray();
		boolean found = false;
		for (int i = 0; i < a.length(); i++) {
			JSONObject o = a.optJSONObject(i);
			if (o == null) continue;
			if (o.optString("id").equals(id)) { next.put(r); found = true; }
			else next.put(o);
		}
		if (!found) next.put(r);
		sp.edit().putString("list", next.toString()).apply();

		String pw = in.optString("password");
		if (in.optBoolean("forgetPassword")) setPassword(id, null);
		else if (!pw.isEmpty()) setPassword(id, pw);
		return id;
	}

	synchronized void remove(String id) {
		JSONArray a = all(), next = new JSONArray();
		for (int i = 0; i < a.length(); i++) {
			JSONObject o = a.optJSONObject(i);
			if (o != null && !o.optString("id").equals(id)) next.put(o);
		}
		sp.edit().putString("list", next.toString()).remove("pw." + id).remove("hk." + id).apply();
	}

	/* ---------------- addresses ---------------- */

	/** "http://192.168.1.1/home/" -> "192.168.1.1"; keeps a port and IPv6 brackets. */
	static String cleanAddr(String v) {
		v = v == null ? "" : v.trim();
		v = v.replaceFirst("(?i)^[a-z][a-z0-9+.-]*://", "");
		int slash = v.indexOf('/');
		if (slash >= 0) v = v.substring(0, slash);
		int at = v.lastIndexOf('@');
		if (at >= 0) v = v.substring(at + 1);
		return v.replaceAll("\\s", "");
	}

	/** The host part of an address, for SSH: "[fd00::1]:8080" -> "fd00::1". */
	static String host(String addr) {
		if (addr.startsWith("[")) {
			int end = addr.indexOf(']');
			return end > 0 ? addr.substring(1, end) : addr;
		}
		int colon = addr.indexOf(':');
		if (colon >= 0 && colon == addr.lastIndexOf(':')) return addr.substring(0, colon);
		return addr;
	}

	/* ---------------- passwords ---------------- */

	synchronized String password(String id) {
		String v = sp.getString("pw." + id, null);
		if (v == null) return null;
		try {
			String[] p = v.split(":", 2);
			byte[] iv = Base64.decode(p[0], Base64.NO_WRAP);
			byte[] ct = Base64.decode(p[1], Base64.NO_WRAP);
			Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
			c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
			return new String(c.doFinal(ct), StandardCharsets.UTF_8);
		} catch (Exception e) {
			// the keystore key is gone (app data restored elsewhere, phone reset):
			// the saved password can't be used any more
			sp.edit().remove("pw." + id).apply();
			return null;
		}
	}

	synchronized void setPassword(String id, String pw) {
		if (pw == null || pw.isEmpty()) {
			sp.edit().remove("pw." + id).apply();
			return;
		}
		try {
			Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
			c.init(Cipher.ENCRYPT_MODE, key());
			byte[] ct = c.doFinal(pw.getBytes(StandardCharsets.UTF_8));
			sp.edit().putString("pw." + id, Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":"
					+ Base64.encodeToString(ct, Base64.NO_WRAP)).apply();
		} catch (Exception e) {
			sp.edit().remove("pw." + id).apply();
		}
	}

	private static SecretKey key() throws Exception {
		KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
		ks.load(null);
		KeyStore.Entry e = ks.getEntry(ALIAS, null);
		if (e instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) e).getSecretKey();
		KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
		kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
				.setBlockModes(KeyProperties.BLOCK_MODE_GCM)
				.setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
				.setKeySize(256)
				.build());
		return kg.generateKey();
	}

	/* ---------------- SSH host keys ---------------- */

	/** {type, key (base64), fp} or null when none is saved yet. */
	synchronized JSONObject hostKey(String id) {
		String v = sp.getString("hk." + id, null);
		if (v == null) return null;
		try {
			return new JSONObject(v);
		} catch (JSONException e) {
			return null;
		}
	}

	synchronized void setHostKey(String id, String type, String keyB64, String fp) {
		try {
			JSONObject o = new JSONObject();
			o.put("type", type);
			o.put("key", keyB64);
			o.put("fp", fp);
			sp.edit().putString("hk." + id, o.toString()).apply();
		} catch (JSONException ignored) { }
	}

	synchronized void clearHostKey(String id) {
		sp.edit().remove("hk." + id).apply();
	}
}
