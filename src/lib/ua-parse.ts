export function parseUserAgent(ua: string | null): {
  device: string | null;
  browser: string | null;
  os: string | null;
} {
  if (!ua) return { device: null, browser: null, os: null };

  let device: string | null = null;
  if (/iPhone/i.test(ua)) device = "iPhone";
  else if (/iPad/i.test(ua)) device = "iPad";
  else if (/Android/i.test(ua) && /Mobile/i.test(ua)) device = "Android Phone";
  else if (/Android/i.test(ua)) device = "Android Tablet";
  else if (/Macintosh|Mac OS/i.test(ua)) device = "Mac";
  else if (/Windows/i.test(ua)) device = "Windows PC";
  else if (/Linux/i.test(ua)) device = "Linux PC";
  else device = "その他";

  let browser: string | null = null;
  const edgeMatch = ua.match(/Edg(?:e|A|iOS)?\/(\d+)/);
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const firefoxMatch = ua.match(/Firefox\/(\d+)/);
  const safariMatch = ua.match(/Version\/(\d+(?:\.\d+)?).*Safari/);
  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (chromeMatch && !ua.includes("Edg")) browser = `Chrome ${chromeMatch[1]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;
  else if (safariMatch) browser = `Safari ${safariMatch[1]}`;
  else if (/Safari/i.test(ua) && /AppleWebKit/i.test(ua)) browser = "Safari";

  let os: string | null = null;
  const iosMatch = ua.match(/OS (\d+[_\.]\d+)/);
  const macMatch = ua.match(/Mac OS X (\d+[_\.]\d+)/);
  const winMatch = ua.match(/Windows NT (\d+\.\d+)/);
  const androidMatch = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (iosMatch) os = `iOS ${iosMatch[1]!.replace(/_/g, ".")}`;
  else if (macMatch) os = `macOS ${macMatch[1]!.replace(/_/g, ".")}`;
  else if (winMatch) {
    const ver = winMatch[1];
    if (ver === "10.0") os = "Windows 10/11";
    else if (ver === "6.3") os = "Windows 8.1";
    else if (ver === "6.1") os = "Windows 7";
    else os = `Windows NT ${ver}`;
  } else if (androidMatch) os = `Android ${androidMatch[1]}`;

  return { device, browser, os };
}
