// Shared product builder for different product types
// Generates HTML characteristics tables + handles images/videos/certificates

const https = require('https');
const http = require('http');

const MAX_FILE_SIZE_MB = 50;

// Build organized HTML characteristics table for any product type
function buildHtmlDescription(item, fieldMappings) {
  const rows = [];
  const addRow = (label, value) => { if (value || value === 0) rows.push({ label, value }); };

  // fieldMappings is an array of { field: 'ItemFieldName', label: 'Display Label' }
  fieldMappings.forEach(mapping => {
    addRow(mapping.label, item[mapping.field]);
  });

  let html = `
<style>
  .product-characteristics {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .product-characteristics th {
    background-color: #8B1A1A;
    color: #fff;
    padding: 12px;
    text-align: left;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 1px;
  }
  .product-characteristics td {
    padding: 12px;
    border-bottom: 1px solid #e5e5e5;
    font-size: 14px;
  }
  .product-characteristics tr:hover {
    background-color: #f9f9f9;
  }
  .product-characteristics td:first-child {
    color: #666;
    font-weight: 500;
    width: 35%;
  }
</style>

<h2 style="margin-top: 30px; font-size: 18px; font-weight: 600;">PRODUCT CHARACTERISTICS</h2>

<table class="product-characteristics">
  <thead>
    <tr>
      <th>CHARACTERISTIC</th>
      <th>DETAILS</th>
    </tr>
  </thead>
  <tbody>`;

  rows.forEach(row => {
    html += `
    <tr>
      <td>${row.label}</td>
      <td>${row.value}</td>
    </tr>`;
  });

  html += `
  </tbody>
</table>`;

  // Add links
  if (item.DnaLink) {
    html += `<p style="margin-top: 20px; color: #666;"><a href="${item.DnaLink}" target="_blank">View on DNA</a></p>`;
  }
  if (item.CertificateLink) {
    html += `<p style="color: #666;"><a href="${item.CertificateLink}" target="_blank">Download Certificate</a></p>`;
  }

  return html;
}

// Download file from URL with size limit
async function downloadFile(fileUrl, maxSizeMb = 50) {
  return new Promise((resolve, reject) => {
    const url = new URL(fileUrl);
    const protocol = url.protocol === 'http:' ? http : https;

    const req = protocol.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        downloadFile(new URL(res.headers.location, fileUrl).toString(), maxSizeMb)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Download: HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      let size = 0;

      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxSizeMb * 1024 * 1024) {
          res.destroy();
          reject(new Error(`Exceeds ${maxSizeMb}MB`));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Field mappings for different product types
const FIELD_MAPPINGS = {
  watch: [
    { field: 'Brand', label: 'Brand' },
    { field: 'Model', label: 'Model' },
    { field: 'MM', label: 'Size (MM)' },
    { field: 'Metal', label: 'Metal' },
    { field: 'Bracelet', label: 'Bracelet' },
    { field: 'Dial', label: 'Dial' },
    { field: 'Bezel', label: 'Bezel' },
    { field: 'Condition', label: 'Condition' },
    { field: 'Links', label: 'Links' },
    { field: 'Box', label: 'Box' },
    { field: 'Paper', label: 'Paper' },
    { field: 'Reference', label: 'Reference' },
    { field: 'Year', label: 'Year of Production' },
    { field: 'Comment', label: 'Comment' },
    { field: 'Movement', label: 'Movement' },
    { field: 'Case', label: 'Case' }
  ],

  lab: [
    { field: 'Diamond_Type', label: 'Diamond Type' },
    { field: 'Weight', label: 'Weight (CT)' },
    { field: 'Shape', label: 'Shape' },
    { field: 'Color', label: 'Color' },
    { field: 'Clarity', label: 'Clarity' },
    { field: 'Cut_Grade', label: 'Cut Grade' },
    { field: 'Polish', label: 'Polish' },
    { field: 'Symmetry', label: 'Symmetry' },
    { field: 'Fluorescence_Intensity', label: 'Fluorescence' },
    { field: 'Measurements', label: 'Measurements' },
    { field: 'Lab', label: 'Laboratory' },
    { field: 'Treatment', label: 'Treatment' },
    { field: 'Ratio', label: 'Ratio' },
    { field: 'DEPTH_PER', label: 'Depth %' },
    { field: 'TABLE_PER', label: 'Table %' },
    { field: 'Crown_Height', label: 'Crown Height' },
    { field: 'Pavilion_Depth', label: 'Pavilion Depth' },
    { field: 'Pavilion_Angle', label: 'Pavilion Angle' },
    { field: 'Report_Issue_Date', label: 'Report Date' },
    { field: 'Cert_Comments', label: 'Comments' }
  ],

  natural: [
    { field: 'Weight', label: 'Weight (CT)' },
    { field: 'Shape', label: 'Shape' },
    { field: 'Color', label: 'Color' },
    { field: 'Clarity', label: 'Clarity' },
    { field: 'Cut_Grade', label: 'Cut Grade' },
    { field: 'Polish', label: 'Polish' },
    { field: 'Symmetry', label: 'Symmetry' },
    { field: 'Fluorescence_Intensity', label: 'Fluorescence' },
    { field: 'Measurements', label: 'Measurements' },
    { field: 'Lab', label: 'Laboratory' },
    { field: 'Report_Issue_Date', label: 'Report Date' },
    { field: 'Cert_Comments', label: 'Comments' }
  ],

  jewelry: [
    { field: 'jew_type', label: 'Type' },
    { field: 'section', label: 'Section' },
    { field: 'metal_type', label: 'Metal' },
    { field: 'metal_weight', label: 'Metal Weight (g)' },
    { field: 'diamond_weight', label: 'Diamond Weight (ct)' },
    { field: 'diamond_pcs', label: 'Diamond Pieces' },
    { field: 'size_inch', label: 'Size (inch)' },
    { field: 'style', label: 'Style' },
    { field: 'Condition', label: 'Condition' }
  ]
};

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'string') req.write(body);
      else req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Attach certificate PDF to product
async function attachCertificate(productId, certificateUrl, accessToken, storeDomain, apiVersion = '2024-10') {
  try {
    const buffer = await downloadFile(certificateUrl, 50);
    const fileData = buffer.toString('base64');

    const response = await makeRequest({
      hostname: storeDomain,
      path: `/admin/api/${apiVersion}/graphql.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    }, {
      query: `mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files { id fileStatus }
          userErrors { field message }
        }
      }`,
      variables: {
        files: [{
          originalSource: `data:application/pdf;base64,${fileData}`,
          alt: 'Certificate'
        }]
      }
    });

    const errors = response.body?.data?.fileCreate?.userErrors || [];
    if (errors.length > 0) throw new Error(`Certificate upload: ${JSON.stringify(errors)}`);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function createStagedUpload(filename, fileSize, accessToken, storeDomain, apiVersion) {
  const response = await makeRequest({
    hostname: storeDomain,
    path: `/admin/api/${apiVersion}/graphql.json`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken }
  }, {
    query: `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    variables: {
      input: [{
        resource: 'VIDEO',
        filename,
        mimeType: 'video/mp4',
        httpMethod: 'POST',
        fileSize: String(fileSize)
      }]
    }
  });

  const errors = response.body?.data?.stagedUploadsCreate?.userErrors || [];
  if (errors.length > 0) throw new Error(`Staged upload: ${JSON.stringify(errors)}`);
  return response.body.data.stagedUploadsCreate.stagedTargets[0];
}

async function uploadToS3(buffer, stagingTarget) {
  const boundary = '----FormBoundary' + Date.now();
  let bodyParts = [];

  stagingTarget.parameters.forEach(param => {
    bodyParts.push(`--${boundary}`, `Content-Disposition: form-data; name="${param.name}"`, '', param.value);
  });

  bodyParts.push(`--${boundary}`, `Content-Disposition: form-data; name="file"; filename="video.mp4"`, 'Content-Type: video/mp4', '');

  const headerPart = bodyParts.join('\r\n') + '\r\n';
  const footerPart = `\r\n--${boundary}--\r\n`;
  const url = new URL(stagingTarget.url);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(headerPart) + buffer.length + Buffer.byteLength(footerPart)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if ([200, 204].includes(res.statusCode)) resolve(stagingTarget.resourceUrl);
        else reject(new Error(`S3 upload: ${res.statusCode} ${data}`));
      });
    });
    req.on('error', reject);
    req.write(headerPart);
    req.write(buffer);
    req.write(footerPart);
    req.end();
  });
}

// Attach video to a Shopify product. YouTube/Vimeo → EXTERNAL_VIDEO; direct MP4 → staged upload → VIDEO.
async function attachVideoToProduct(productId, videoUrl, accessToken, storeDomain, apiVersion = '2024-10') {
  const productGid = String(productId).startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`;
  const isExternal = /youtube\.com|youtu\.be|vimeo\.com/i.test(videoUrl);

  let originalSource = videoUrl;
  let mediaContentType = 'EXTERNAL_VIDEO';

  if (!isExternal) {
    const buffer = await downloadFile(videoUrl, 200);
    const stagingTarget = await createStagedUpload('product_video.mp4', buffer.length, accessToken, storeDomain, apiVersion);
    originalSource = await uploadToS3(buffer, stagingTarget);
    mediaContentType = 'VIDEO';
  }

  const response = await makeRequest({
    hostname: storeDomain,
    path: `/admin/api/${apiVersion}/graphql.json`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken }
  }, {
    query: `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        product { id media(first: 10) { edges { node { id mediaContentType } } } }
        userErrors { field message }
      }
    }`,
    variables: {
      productId: productGid,
      media: [{ originalSource, alt: 'Product Video', mediaContentType }]
    }
  });

  const errors = response.body?.data?.productCreateMedia?.userErrors || [];
  if (errors.length > 0) throw new Error(`productCreateMedia: ${JSON.stringify(errors)}`);

  const mediaCount = response.body?.data?.productCreateMedia?.product?.media?.edges?.length || 0;
  return { mediaContentType, mediaCount };
}

module.exports = {
  buildHtmlDescription,
  downloadFile,
  attachCertificate,
  attachVideoToProduct,
  FIELD_MAPPINGS,
  MAX_FILE_SIZE_MB
};
