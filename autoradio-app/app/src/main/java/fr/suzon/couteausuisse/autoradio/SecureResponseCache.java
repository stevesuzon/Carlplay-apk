package fr.suzon.couteausuisse.autoradio;

import android.content.Context;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Petit cache local chiffré réservé à l'application autoradio.
 * Les données restent dans le stockage privé Android de l'application.
 */
final class SecureResponseCache {
    static final class Entry {
        final byte[] data;
        final String mime;
        Entry(byte[] data, String mime) { this.data = data; this.mime = mime; }
    }

    private static final String ALIAS = "couteau_suisse_autoradio_cache_v1";
    private static final long MAX_BYTES = 80L * 1024L * 1024L;
    private final File dir;

    SecureResponseCache(Context context) {
        dir = new File(context.getCacheDir(), "secure_web");
        if (!dir.exists()) dir.mkdirs();
    }

    boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M;
    }

    Entry get(String url, long maxAgeMs, long staleMaxAgeMs) {
        if (!supported()) return null;
        try {
            String key = hash(url);
            File meta = new File(dir, key + ".meta");
            File bin = new File(dir, key + ".bin");
            if (!meta.isFile() || !bin.isFile()) return null;
            String m = new String(readAll(meta), StandardCharsets.UTF_8);
            String[] parts = m.split("\\n", 2);
            long savedAt = Long.parseLong(parts[0]);
            long age = Math.max(0, System.currentTimeMillis() - savedAt);
            if (maxAgeMs > 0 && age > maxAgeMs) {
                if (staleMaxAgeMs <= 0) return null;
                if (age > staleMaxAgeMs) {
                    meta.delete(); bin.delete(); return null;
                }
            }
            byte[] packed = readAll(bin);
            if (packed.length < 13) return null;
            ByteBuffer bb = ByteBuffer.wrap(packed);
            int ivLen = bb.get() & 0xff;
            if (ivLen < 12 || ivLen > 32 || packed.length <= 1 + ivLen) return null;
            byte[] iv = new byte[ivLen];
            bb.get(iv);
            byte[] cipherText = new byte[bb.remaining()];
            bb.get(cipherText);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            byte[] plain = cipher.doFinal(cipherText);
            String mime = parts.length > 1 ? parts[1].trim() : "application/octet-stream";
            return new Entry(plain, mime);
        } catch (Exception ignored) {
            return null;
        }
    }

    void put(String url, byte[] data, String mime) {
        if (!supported() || data == null || data.length == 0) return;
        try {
            String key = hash(url);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] enc = cipher.doFinal(data);
            ByteBuffer packed = ByteBuffer.allocate(1 + iv.length + enc.length);
            packed.put((byte) iv.length).put(iv).put(enc);
            writeAll(new File(dir, key + ".bin"), packed.array());
            writeAll(new File(dir, key + ".meta"),
                    (System.currentTimeMillis() + "\n" + (mime == null ? "application/octet-stream" : mime))
                            .getBytes(StandardCharsets.UTF_8));
            trim();
        } catch (Exception ignored) {
        }
    }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        java.security.Key existing = ks.getKey(ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return kg.generateKey();
    }

    private void trim() {
        try {
            File[] files = dir.listFiles((d, n) -> n.endsWith(".bin"));
            if (files == null) return;
            long total = 0;
            for (File f : files) total += f.length();
            if (total <= MAX_BYTES) return;
            java.util.Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
            for (File f : files) {
                String base = f.getName().substring(0, f.getName().length() - 4);
                long len = f.length();
                f.delete();
                new File(dir, base + ".meta").delete();
                total -= len;
                if (total <= MAX_BYTES * 3 / 4) break;
            }
        } catch (Exception ignored) {
        }
    }

    private static String hash(String v) throws Exception {
        byte[] b = MessageDigest.getInstance("SHA-256").digest(v.getBytes(StandardCharsets.UTF_8));
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format(java.util.Locale.US, "%02x", x));
        return s.toString();
    }

    private static byte[] readAll(File f) throws Exception {
        try (FileInputStream in = new FileInputStream(f);
             java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
            byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return out.toByteArray();
        }
    }

    private static void writeAll(File f, byte[] b) throws Exception {
        try (FileOutputStream out = new FileOutputStream(f, false)) {
            out.write(b);
            out.flush();
        }
    }
}
