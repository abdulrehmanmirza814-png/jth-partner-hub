// Facebook Page + Instagram posting through Meta's official Graph API (no browser, no password).
const VERSION = () => process.env.META_GRAPH_VERSION || 'v23.0';

export class Meta {
  constructor({ pageId = process.env.META_PAGE_ID, pageToken = process.env.META_PAGE_TOKEN, igUserId = process.env.META_IG_USER_ID, fetchImpl = fetch } = {}) {
    Object.assign(this, { pageId, pageToken, igUserId, fetchImpl });
  }

  ready(platform) { return platform === 'facebook' ? !!(this.pageId && this.pageToken) : !!(this.igUserId && this.pageToken); }

  async post(path, fields) {
    const res = await this.fetchImpl(`https://graph.facebook.com/${VERSION()}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, access_token: this.pageToken }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Meta API: ${data.error?.message || res.status}`);
    return data;
  }

  async postFacebook({ message, link, imageUrl }) {
    if (!this.pageId || !this.pageToken) throw new Error('Set META_PAGE_ID and META_PAGE_TOKEN in .env');
    const r = imageUrl
      ? await this.post(`${this.pageId}/photos`, { url: imageUrl, caption: message })
      : await this.post(`${this.pageId}/feed`, { message, ...(link ? { link } : {}) });
    return `facebook:${r.post_id || r.id}`;
  }

  /** Instagram needs a public image URL: step 1 creates the media, step 2 publishes it. */
  async postInstagram({ caption, imageUrl }) {
    if (!this.igUserId || !this.pageToken) throw new Error('Set META_IG_USER_ID and META_PAGE_TOKEN in .env');
    if (!imageUrl) throw new Error('Instagram posts need an image URL');
    const c = await this.post(`${this.igUserId}/media`, { image_url: imageUrl, caption });
    const p = await this.post(`${this.igUserId}/media_publish`, { creation_id: c.id });
    return `instagram:${p.id}`;
  }
}

export function socialExecutors(meta) {
  return {
    social_post: async (item) => {
      const { platform, caption, link, image_url } = item.payload;
      if (platform === 'facebook') return meta.postFacebook({ message: caption, link, imageUrl: image_url });
      if (platform === 'instagram') return meta.postInstagram({ caption, imageUrl: image_url });
      throw new Error(`unknown platform ${platform}`);
    },
  };
}
