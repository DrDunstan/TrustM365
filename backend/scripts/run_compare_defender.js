(async () => {
  try {
    const payload = { currentResources: {
      "policy-1": {
        id: "policy-1",
        displayName: "Sample Defender Policy",
        settings: [
          { name: "defenderRequireCloudProtection", value: "device_vendor_msft_policy_config_defender_allowcloudprotection_1" },
          { name: "defenderRequireNetworkInspectionSystem", value: "device_vendor_msft_policy_config_defender_enablenetworkprotection_1" },
          { name: "defenderPuaProtection", value: "device_vendor_msft_policy_config_defender_puaprotection_1" }
        ]
      }
    }};

    const url = 'http://127.0.0.1:3001/api/reference-templates/win-oib-es-defender-antivirus-d-av-configuration-v3-3/compare';
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const txt = await res.text();
    console.log('HTTP', res.status);
    try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); } catch (e) { console.log(txt); }
  } catch (err) {
    console.error('Request failed:', err);
    process.exit(2);
  }
})();
