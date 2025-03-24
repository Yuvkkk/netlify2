const fetch = require("node-fetch");

const accountId = "005fa8f08ff41590000000007";
const applicationKey = "K005GSPBDYHFwmnMHSMPTVgvlxwabLw";
const authUrl = "https://api.backblazeb2.com/b2api/v2/b2_authorize_account";
const PART_SIZE = 5 * 1024 * 1024; // 每个分片 5MB，可调整

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  console.log("收到请求:", event.body.slice(0, 100));
  try {
    if (!event.body) {
      console.log("错误: 请求体为空");
      return { statusCode: 400, body: JSON.stringify({ message: "请求体为空" }) };
    }

    const { file, fileName, mimeType } = JSON.parse(event.body);
    if (!file || !fileName) {
      console.log("错误: 缺少文件或文件名");
      return { statusCode: 400, body: JSON.stringify({ message: "缺少文件或文件名" }) };
    }

    console.log("文件信息:", fileName, mimeType || "application/octet-stream");
    const fileBuffer = Buffer.from(file, "base64"); // 解码 Base64 为二进制
    console.log("文件大小:", fileBuffer.length);

    // Step 1: 授权账户
    const authResponse = await fetch(authUrl, {
      method: "GET",
      headers: {
        Authorization: "Basic " + Buffer.from(`${accountId}:${applicationKey}`).toString("base64"),
      },
    });
    const authData = await authResponse.json();
    if (!authResponse.ok) throw new Error(JSON.stringify(authData));
    const { authorizationToken, apiUrl } = authData;
    console.log("B2 授权成功", { authorizationToken, apiUrl });

    // Step 2: 启动大文件上传
    const startLargeFileResponse = await fetch(`${apiUrl}/b2api/v2/b2_start_large_file`, {
      method: "POST",
      headers: {
        Authorization: authorizationToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bucketId: "5f4a78ff70c84f6f94510519",
        fileName: encodeURIComponent(fileName),
        contentType: mimeType || "application/octet-stream",
      }),
    });
    const startLargeFileData = await startLargeFileResponse.json();
    if (!startLargeFileResponse.ok) throw new Error(JSON.stringify(startLargeFileData));
    const { fileId } = startLargeFileData;
    console.log("启动大文件上传成功:", fileId);

    // Step 3: 分片上传
    const parts = [];
    for (let i = 0; i < fileBuffer.length; i += PART_SIZE) {
      const partBuffer = fileBuffer.slice(i, Math.min(i + PART_SIZE, fileBuffer.length));
      const partNumber = Math.floor(i / PART_SIZE) + 1;

      // 获取分片上传 URL
      const uploadPartUrlResponse = await fetch(`${apiUrl}/b2api/v2/b2_get_upload_part_url`, {
        method: "POST",
        headers: {
          Authorization: authorizationToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fileId }),
      });
      const uploadPartUrlData = await uploadPartUrlResponse.json();
      if (!uploadPartUrlResponse.ok) throw new Error(JSON.stringify(uploadPartUrlData));
      const { uploadUrl, authorizationToken: partAuthToken } = uploadPartUrlData;

      // 计算分片 SHA1
      const crypto = require("crypto");
      const sha1 = crypto.createHash("sha1").update(partBuffer).digest("hex");

      // 上传分片
      const uploadPartResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: partAuthToken,
          "Content-Type": "b2/x-auto",
          "X-Bz-Part-Number": partNumber,
          "X-Bz-Content-Sha1": sha1,
          "Content-Length": partBuffer.length,
        },
        body: partBuffer,
      });
      if (!uploadPartResponse.ok) throw new Error(await uploadPartResponse.text());
      console.log(`分片 ${partNumber} 上传成功，大小: ${partBuffer.length} 字节`);
      parts.push({ partNumber, sha1 });
    }

    // Step 4: 完成大文件上传
    const finishLargeFileResponse = await fetch(`${apiUrl}/b2api/v2/b2_finish_large_file`, {
      method: "POST",
      headers: {
        Authorization: authorizationToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileId,
        partSha1Array: parts.map((p) => p.sha1),
      }),
    });
    if (!finishLargeFileResponse.ok) throw new Error(await finishLargeFileResponse.text());
    console.log("大文件上传完成:", fileName);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "File uploaded successfully",
        fileUrl: `${apiUrl}/file/my-free-storage/${encodeURIComponent(fileName)}`,
      }),
    };
  } catch (error) {
    console.error("处理失败:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error uploading file", error: error.message }),
    };
  }
};
