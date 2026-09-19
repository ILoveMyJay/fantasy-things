if(typeof console!=="undefined"){console.log=function(){};console.warn=function(){};console.error=function(){};}
/**
 * popup.js — FLOW Factory 팝업 (Side Panel 열기 전용)
 */
document.getElementById('btnOpenSidePanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  }
});
