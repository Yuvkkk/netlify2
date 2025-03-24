const fetch = require("node-fetch");
const crypto = require("crypto");

const accountId = "005fa8f08ff41590000000007";
const applicationKey = "K005GSPBDYHFwmnMHSMPTVgvlxwabLw";
const authUrl = "https://api.backblazeb2.com/b2api/v2/b2_authorize_account";
const PART_SIZE = 5 * 1024 * 1024; // 5MB，与前端一致

// 内存中临时存储分片信息（生产环境应使用数据库）
const uploadSessions = new Map();

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const { file, fileName, mimeType, partNumber, totalParts, fileId: incomingFileId } = body;

    if (!file || !fileName || !partNumber || !totalParts) {
      return { statusCode: 400, body: JSON.stringify({ message: "缺少必要参数" }) };
    }

    console.log(`收到分片: ${partNumber}/${totalParts}, 文件名: ${fileName}`);
    const fileBuffer = Buffer.from(file, "base64");

    // Step 1: 授权账户
    const authResponse = await fetch(authUrl, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${accountId}:${applicationKey}`).toString("base64"),
      },
    });
    const authData = await authResponse.json();
    if (!authResponse.ok) throw new Error(JSON.stringify(authData));
    const { authorizationToken, apiUrl } = authData;

    // Step 2: 处理分片上传
    let fileId = incomingFileId;
    let session = uploadSessions.get(fileName);

    // 第一个分片：启动大文件上传
    if (partNumber === 1) {
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
      fileId = startLargeFileData.fileId;
      session = { fileId, parts: [] };
      uploadSessions.set(fileName, session);
      console.log("启动大文件上传:", fileId);
    }

    if (!fileId || !session) {
      return { statusCode: 400, body: JSON.stringify({ message: "无效的 fileId 或会话" }) };
    }

    // Step 3: 上传当前分片
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

    const sha1 = crypto.createHash("sha1").update(fileBuffer).digest("hex");
    const uploadPartResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: partAuthToken,
        "Content-Type": "b2/x-auto",
        "X-Bz-Part-Number": partNumber,
        "X-Bz-Content-Sha1": sha1,
        "Content-Length": fileBuffer.length,
      },
      body: fileBuffer,
    });
    if (!uploadPartResponse.ok) throw new Error(await uploadPartResponse.text());
    session.parts.push({ partNumber, sha1 });
    console.log(`分片 ${partNumber} 上传成功`);

    // Step 4: 最后一个分片，完成上传
    if (partNumber === totalParts) {
      const finishLargeFileResponse = await fetch(`${apiUrl}/b2api/v2/b2_finish_large_file`, {
        method: "POST",
        headers: {
          Authorization: authorizationToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId,
          partSha1Array: session.parts.sort((a, b) => a.partNumber - b.partNumber).map((p) => p.sha1),
        }),
      });
      if (!finishLargeFileResponse.ok) throw new Error(await finishLargeFileResponse.text());
      uploadSessions.delete(fileName); // 清理会话
      console.log("文件上传完成:", fileName);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "File uploaded successfully",
          fileUrl: `${apiUrl}/file/my-free-storage/${encodeURIComponent(fileName)}`,
        }),
      };
    }

    // 非最后一个分片，返回 fileId
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Part ${partNumber} uploaded successfully`,
        fileId,
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
