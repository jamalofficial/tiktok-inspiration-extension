const setBtnToggle = (status) => {
  const btn = document.getElementById("start");
  if(status){
    btn.classList.remove("info-btn");
    btn.classList.add("warning-btn");
    btn.innerText = "Processing...";
  }
  else{
    btn.classList.remove("warning-btn");
    btn.classList.add("info-btn");
    btn.innerText = "Start Automation";
  }
}
document.getElementById("start").onclick = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ["content.js"]
    }, () => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "startAutomation" });
      setBtnToggle(true);
    });
  });
};

document.getElementById("download").onclick = () => {
  chrome.runtime.sendMessage({ action: "downloadData" });
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "log") {
    document.getElementById("log").innerText = msg.data;
  }
  if(msg.action == "stopped"){
    setBtnToggle(false);
  }
});
