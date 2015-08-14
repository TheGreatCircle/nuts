var _ = require('lodash');
var Q = require('q');
var semver = require('semver');

var config = require('./config');
var github = require('./github');
var platforms = require('./platforms');

// Normalize tag name
function normalizeTag(tag) {
    if (tag[0] == 'v') tag = tag.slice(1);
    return tag;
}

// Extract channel of version
function extractChannel(tag) {
    var suffix = tag.split('-')[1];
    if (!suffix) return 'stable';

    return suffix.split('.')[0];
}

// Normalize a release to a version
function normalizeVersion(release) {
    // Ignore draft
    if (release.draft) return null;

    var downloadCount = 0;
    var releasePlatforms = _.chain(release.assets)
        .map(function(asset) {
            var platform = platforms.detect(asset.name);
            if (!platform) return null;

            downloadCount = downloadCount + asset.download_count;
            return [platform, {
                filename: asset.name,
                download_url: asset.url,
                download_count: asset.download_count
            }];
        })
        .compact()
        .object()
        .value();

    return {
        tag: normalizeTag(release.tag_name),
        channel: extractChannel(release.tag_name),
        notes: release.body || "",
        published_at: new Date(release.published_at),
        platforms: releasePlatforms,
        download_count: downloadCount
    };
}

// Compare two version
function compareVersions(v1, v2) {
    if (semver.gt(v1.tag, v2.tag)) {
        return -1;
    }
    if (semver.lt(v1.tag, v2.tag)) {
        return 1;
    }
    return 0;
}

// List all available version
var listVersions = _.memoize(function() {
    return github.releases()
    .spread(function(releases) {
        return _.chain(releases)
            .map(normalizeVersion)
            .compact()
            .sort(compareVersions)
            .value();
    });
}, function() {
    return Math.ceil(Date.now()/config.versions.timeout)
});

// Get a specific version
function getVersion(tag) {
    return resolveVersion({
        tag: tag
    });
}

// Filter versions
function filterVersions(opts) {
    opts = _.defaults(opts || {}, {
        tag: 'latest',
        platform: null,
        channel: 'stable'
    });
    if (opts.tag == 'latest') opts.tag = '*';
    if (opts.platform) opts.platform = platforms.detect(opts.platform);

    return listVersions()
    .then(function(versions) {
        return _.chain(versions)
            .filter(function(version) {
                // Check channel
                if (opts.channel != '*' && version.channel != opts.channel) return false;

                // Not available for requested paltform
                if (opts.platform && !platforms.satisfies(opts.platform, _.keys(version.platforms))) return false;

                // Check tag satisfies request version
                return semver.satisfies(version.tag, opts.tag);
            })
            .value();
    });
}

// Resolve a platform
function resolveVersion(opts) {
    return filterVersions(opts)
    .then(function(versions) {
        var version = _.first(versions);
        if (!version) throw new Error('Version not found: '+opts.tag);
        return version;
    });
}

module.exports = {
    list: listVersions,
    get: getVersion,
    filter: filterVersions,
    resolve: resolveVersion
};