  // chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  //   chrome.scripting.executeScript({
  //     target: { tabId: tabs[0].id },
  //     files: ["content.js"]
  //   }, () => {
  //     chrome.tabs.sendMessage(tabs[0].id, { action: "startAutomation" });
  //   });
  // });
// ...existing code...

// On page load, if the URL hash contains #explore=1 and the page is https://www.tiktok.com/csi/search*, auto start the process
// chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
//   const tab = tabs[0];
//   if (
//     tab &&
//     tab.url &&
//     tab.url.startsWith("https://www.tiktok.com/csi/search") &&
//     tab.url.includes("#explore=1")
//   ) {
//     chrome.tabs.sendMessage(tab.id, { action: "toggleAutomation" }).then((response) => {
//       toggleBtn(response?.status ?? false);
//       console.log("Auto-started scrapping automation: ", response);
//     });
//   }
// });



// document.getElementById("download").onclick = () => {
//   chrome.runtime.sendMessage({ action: "downloadData" });
// };

chrome.runtime.onMessage.addListener((msg) => {

  if (msg.action === "log") {
    document.getElementById("log").innerText = msg.data;
  }
  if(msg.action == "ti-toggleAutomation"){
    toggleBtn(msg?.status ?? false);
  }
});

const toggleBtn = (status) => {
  const btn = document.getElementById("scrapping-start-btn");
  if(status){
    btn.classList.remove("info-btn");
    btn.classList.add("danger-btn");
    btn.innerText = "Stop Automation";
  }
  else{
    btn.classList.add("info-btn");
    btn.classList.remove("danger-btn");
    btn.innerText = "Start Automation";
  }
}

document.getElementById("scrapping-start-btn").onclick = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "toggleAutomation" }, (response) => {
      // if (chrome.runtime.lastError) {
      //   console.warn("toggleAutomation error:", chrome.runtime.lastError.message);
      //   return;
      // }
      // toggleBtn(response?.status ?? false);
      // console.log("Auto-started scrapping automation:", response);
    });
  });
};
