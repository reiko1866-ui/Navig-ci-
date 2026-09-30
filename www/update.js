(function () {
  "use strict";

  var LOCAL = { code: 2, name: "1.0.1" };
  var API = "https://api.github.com/repos/reiko1866-ui/Navig-ci-/releases?per_page=8";

  function $(id) {
    return document.getElementById(id);
  }

  function parseCode(rel) {
    var tag = String((rel && rel.tag_name) || "");
    var apk = tag.match(/^apk-(\d+)$/i);
    if (apk) return Number(apk[1]);
    var sem = tag.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (sem) return Number(sem[1]) * 10000 + Number(sem[2]) * 100 + Number(sem[3]);
    return 0;
  }

  function apkUrl(rel) {
    var assets = (rel && rel.assets) || [];
    for (var i = 0; i < assets.length; i++) {
      var name = String(assets[i].name || "").toLowerCase();
      if (name.indexOf(".apk") >= 0) return assets[i].browser_download_url;
    }
    return "";
  }

  function plugin() {
    var cap = window.Capacitor;
    if (!cap || !cap.Plugins || !cap.Plugins.AppUpdate) return null;
    return cap.Plugins.AppUpdate;
  }

  function native() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  function show(rel, url) {
    var bar = $("update");
    if (!bar) return;
    bar.hidden = false;
    $("updateText").textContent = "Új verzió: " + (rel.name || rel.tag_name);
    $("updateGo").onclick = function () {
      $("updateText").textContent = "Letöltés…";
      $("updateGo").disabled = true;
      var p = plugin();
      if (p && p.install) {
        p.install({ url: url }).then(function () {
          $("updateText").textContent = "Telepítés indítva.";
        }).catch(function (err) {
          $("updateGo").disabled = false;
          var msg = String((err && err.message) || err || "");
          if (msg.indexOf("engedely") >= 0) $("updateText").textContent = "Engedd a telepítést, aztán újra.";
          else $("updateText").textContent = "A letöltés nem sikerült.";
        });
        return;
      }
      window.location.href = url;
    };
  }

  function check() {
    fetch(API, { headers: { Accept: "application/vnd.github+json" } })
      .then(function (res) { return res.json(); })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        var best = null;
        var bestCode = LOCAL.code;
        list.forEach(function (rel) {
          if (rel.draft || rel.prerelease) return;
          var code = parseCode(rel);
          var url = apkUrl(rel);
          if (url && code > bestCode) {
            best = rel;
            bestCode = code;
          }
        });
        if (best) show(best, apkUrl(best));
      })
      .catch(function () {});
  }

  if (native()) check();
  window.AppVersion = LOCAL;
})();
