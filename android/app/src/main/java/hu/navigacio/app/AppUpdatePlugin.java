package hu.navigacio.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        JSObject out = new JSObject();
        try {
            var info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            out.put("code", code);
            out.put("name", info.versionName);
        } catch (Exception e) {
            out.put("code", 2);
            out.put("name", "1.0.1");
        }
        call.resolve(out);
    }

    @PluginMethod
    public void install(PluginCall call) {
        String src = call.getString("url");
        if (src == null || src.length() < 8) {
            call.reject("url");
            return;
        }
        bridge.getActivity().runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 26) {
                if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                    Intent perm = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName())
                    );
                    perm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(perm);
                    call.reject("engedely");
                    return;
                }
            }
            new Thread(() -> {
                try {
                    File apk = download(src);
                    bridge.getActivity().runOnUiThread(() -> {
                        try {
                            openInstaller(apk);
                            call.resolve();
                        } catch (Exception e) {
                            call.reject(e.getMessage());
                        }
                    });
                } catch (Exception e) {
                    call.reject(e.getMessage());
                }
            }).start();
        });
    }

    private File download(String src) throws Exception {
        String next = src;
        for (int hop = 0; hop < 6; hop++) {
            URL url = new URL(next);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(60000);
            conn.setRequestProperty("User-Agent", "Navigacio/1.0.1");
            conn.connect();
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                next = conn.getHeaderField("Location");
                conn.disconnect();
                if (next == null || next.isEmpty()) throw new Exception("redirect");
                continue;
            }
            if (code != 200) {
                conn.disconnect();
                throw new Exception("http " + code);
            }
            File apk = new File(getContext().getCacheDir(), "Navigacio.apk");
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            } finally {
                conn.disconnect();
            }
            return apk;
        }
        throw new Exception("redirect");
    }

    private void openInstaller(File apk) {
        Activity act = getActivity();
        Uri uri = FileProvider.getUriForFile(act, act.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        act.startActivity(intent);
    }
}
