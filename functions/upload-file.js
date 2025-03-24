const fetch = require("node-fetch");
const crypto = require("crypto");

const accountId = "005fa8f08ff41590000000007";
const applicationKey = "K005GSPBDYHFwmnMHSMPTVgvlxwabLw";
const authUrl = "https://api.backblazeb2.com/b2api/v2/b2_authorize_account";
const PART_SIZE = 5 * 1024 * 1024; // 5MB，符合 B2 要求

const uploadSessions = new Map();

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  console.log("收到请求:", event.body.slice(0, 100));
  try {
    if (!event.body) throw new Error("请求体为空");
    const body = JSON.parse(event.body);
    const { file, fileName, mimeType, partNumber, totalParts, fileId: incomingFileId } = body;

    if (!file || !fileName || !totalParts) {
      throw new Error("缺少必要参数: file, fileName 或 totalParts");
    }

    const fileBuffer = Buffer.from(file, "base64");
    console.log(`文件: ${fileName}, 大小: ${fileBuffer.length} 字节, totalParts: ${totalParts}, partNumber: ${partNumber || "N/A"}`);

    const authResponse = await fetch(authUrl, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${accountId}:${applicationKey}`).toString("base64"),
      },
    });
    const authData = await authResponse.json();
    if (!authResponse.ok) throw new Error(`授权失败: ${JSON.stringify(authData)}`);
    const { authorizationToken, apiUrl } = authData;
    console.log("授权成功");

    if (totalParts === 1) {
      const uploadUrlResponse = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_url`, {
        method: "POST",
        headers: {
          Authorization: authorizationToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bucketId: "5f4a78ff70c84f6f94510519" }),
      });
      const uploadUrlData = await uploadUrlResponse.json();
      if (!uploadUrlResponse.ok) throw new Error(`获取上传 URL 失败: ${JSON.stringify(uploadUrlData)}`);
      const { uploadUrl, authorizationToken: uploadAuthToken } = uploadUrl
