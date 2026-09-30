package hu.navigacio.app;

import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

@CapacitorPlugin(name = "NavSpeak")
public class NavSpeakPlugin extends Plugin implements TextToSpeech.OnInitListener {
    private TextToSpeech tts;
    private boolean ready = false;
    private boolean hu = false;

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), this);
    }

    @Override
    public void onInit(int status) {
        ready = status == TextToSpeech.SUCCESS;
        if (!ready || tts == null) return;
        int result = tts.setLanguage(new Locale("hu", "HU"));
        hu = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED;
        if (!hu) tts.setLanguage(Locale.getDefault());
        tts.setSpeechRate(0.96f);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {}

            @Override
            public void onDone(String utteranceId) {
                notifyDone(utteranceId);
            }

            @Override
            public void onError(String utteranceId) {
                notifyDone(utteranceId);
            }
        });
    }

    private void notifyDone(String id) {
        JSObject ev = new JSObject();
        ev.put("id", id == null ? "" : id);
        notifyListeners("done", ev);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (!ready || tts == null || text == null || text.isEmpty()) {
            call.reject("tts");
            return;
        }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "nav");
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject out = new JSObject();
        out.put("ready", ready);
        out.put("hu", hu);
        call.resolve(out);
    }
}
