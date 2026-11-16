const config = JSON.parse(document.getElementById("overview-config").textContent);

function setReviewPassword(password) {
  const passwordText = document.getElementById("review-password");
  const copyButton = document.getElementById("copy-password");
  const copyStatus = document.getElementById("copy-status");
  passwordText.textContent = password;
  copyButton.hidden = false;

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(password);
      copyButton.textContent = "已复制";
      copyStatus.textContent = "已复制评委访问密码";
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(passwordText);
      selection?.removeAllRanges();
      selection?.addRange(range);
      copyButton.textContent = "手动复制";
      copyStatus.textContent = "已选中评委访问密码，请手动复制";
    }
  });
}

async function loadReviewPassword() {
  try {
    const response = await fetch("/overview/review.json", { cache: "no-store" });
    if (!response.ok) return;

    const data = await response.json();
    if (typeof data?.password === "string" && data.password.trim()) {
      setReviewPassword(data.password);
    }
  } catch {
    // The public reviewer password may be supplied after the page is published.
  }
}

void loadReviewPassword();

function getVideo(source) {
  const bvidPattern = /^BV[0-9A-Za-z]{10}$/;
  const avidPattern = /^av([1-9][0-9]*)$/i;
  let id = source.trim();
  let part = "";

  if (!bvidPattern.test(id) && !avidPattern.test(id)) {
    let url;
    try {
      url = new URL(id);
    } catch {
      return null;
    }

    if (!["https:", "http:"].includes(url.protocol)) return null;
    if (url.hostname === "player.bilibili.com") {
      const aid = url.searchParams.get("aid");
      id = url.searchParams.get("bvid") || (aid ? `av${aid}` : "");
    } else if (["www.bilibili.com", "bilibili.com", "m.bilibili.com"].includes(url.hostname)) {
      id = url.pathname.match(/^\/video\/([^/]+)\/?$/)?.[1] ?? "";
    } else {
      return null;
    }
    part = url.searchParams.get("p") || url.searchParams.get("page") || "";
  }

  const player = new URL("https://player.bilibili.com/player.html?autoplay=0");
  const avid = id.match(avidPattern);
  if (bvidPattern.test(id)) {
    player.searchParams.set("bvid", id);
  } else if (avid) {
    player.searchParams.set("aid", avid[1]);
    id = `av${avid[1]}`;
  } else {
    return null;
  }

  const watch = new URL(`https://www.bilibili.com/video/${id}/`);
  if (/^[1-9][0-9]*$/.test(part)) {
    player.searchParams.set("p", part);
    watch.searchParams.set("p", part);
  }
  return { player, watch };
}

const video = getVideo(config.bilibili);
if (video) {
  const player = document.getElementById("video-player");
  const link = document.getElementById("video-link");

  player.src = video.player.href;
  player.hidden = false;
  link.href = video.watch.href;
  link.hidden = false;
  document.getElementById("video-status").hidden = true;
  document.getElementById("video-placeholder").hidden = true;
}
