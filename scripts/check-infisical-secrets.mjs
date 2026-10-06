const configured = Boolean(process.env.ATLAS_API_KEY || process.env.ATLASCLOUD_API_KEY);
console.log(JSON.stringify({ atlasConfigured: configured }));
process.exitCode = configured ? 0 : 1;
