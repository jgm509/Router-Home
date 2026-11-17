package app.routerhome;

import com.jcraft.jsch.HostKey;
import com.jcraft.jsch.HostKeyRepository;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.UserInfo;

import org.json.JSONObject;

import java.util.Base64;

/**
 * SSH host keys, saved per router instead of per address. Routers that share
 * an address (all of them at 192.168.1.1, say) each keep their own key, so
 * switching routers never looks like a changed key. A router that really
 * changed its key (after a reflash) asks once whether to replace it.
 */
final class HostKeys implements HostKeyRepository {
	static final int NONE = 0, NEW = 1, CHANGED_KEY = 2;

	private final Routers store;
	private final String id;

	/* what the last check found, for the question shown to the user */
	volatile int found = NONE;
	volatile String foundType = "", foundFp = "", savedFp = "";

	HostKeys(Routers store, String id) {
		this.store = store;
		this.id = id;
	}

	@Override
	public int check(String host, byte[] key) {
		JSONObject saved = store.hostKey(id);
		String b64 = Base64.getEncoder().encodeToString(key);
		try {
			HostKey hk = new HostKey(host, key);
			foundType = hk.getType();
			foundFp = fingerprint(key);
		} catch (JSchException e) {
			foundType = "";
			foundFp = "";
		}
		if (saved == null) {
			found = NEW;
			return NOT_INCLUDED;
		}
		if (b64.equals(saved.optString("key"))) {
			found = NONE;
			return OK;
		}
		found = CHANGED_KEY;
		savedFp = saved.optString("type") + " " + saved.optString("fp");
		return CHANGED;
	}

	@Override
	public void add(HostKey hk, UserInfo ui) {
		store.setHostKey(id, hk.getType(), hk.getKey(), fingerprint(Base64.getDecoder().decode(hk.getKey())));
	}

	/** "SHA256:…", the way ssh-keygen -l and dropbearkey -y show a key. */
	static String fingerprint(byte[] key) {
		try {
			byte[] h = java.security.MessageDigest.getInstance("SHA-256").digest(key);
			return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(h);
		} catch (java.security.NoSuchAlgorithmException e) {
			return "";
		}
	}

	@Override
	public void remove(String host, String type) {
		store.clearHostKey(id);
	}

	@Override
	public void remove(String host, String type, byte[] key) {
		store.clearHostKey(id);
	}

	@Override
	public String getKnownHostsRepositoryID() {
		return "Router Home";
	}

	@Override
	public HostKey[] getHostKey() {
		return getHostKey(null, null);
	}

	/* JSch asks this to prefer the key type it already knows for the host */
	@Override
	public HostKey[] getHostKey(String host, String type) {
		JSONObject saved = store.hostKey(id);
		if (saved == null) return new HostKey[0];
		try {
			HostKey hk = new HostKey(host == null ? "router" : host, Base64.getDecoder().decode(saved.optString("key")));
			if (type != null && !type.equals(hk.getType())) return new HostKey[0];
			return new HostKey[] { hk };
		} catch (Exception e) {
			return new HostKey[0];
		}
	}
}
