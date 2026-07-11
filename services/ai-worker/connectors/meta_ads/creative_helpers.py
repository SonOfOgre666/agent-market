"""Placement + creative helpers from reference_ads/meta_ads/ads.py."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

_PLACEMENT_GROUP_TO_POSITIONS: Dict[str, Dict[str, List[str]]] = {
    "FEED": {
        "publisher_platforms": ["facebook", "instagram"],
        "facebook_positions": ["feed"],
        "instagram_positions": ["stream", "profile_feed"],
    },
    "STORY": {
        "publisher_platforms": ["facebook", "instagram"],
        "facebook_positions": ["story"],
        "instagram_positions": ["story"],
    },
    "MESSENGER": {
        "publisher_platforms": ["messenger"],
    },
    "INSTREAM_VIDEO": {
        "publisher_platforms": ["facebook"],
        "facebook_positions": ["instream_video"],
    },
    "SEARCH": {
        "publisher_platforms": ["facebook"],
        "facebook_positions": ["search"],
    },
    "SHOP": {
        "publisher_platforms": ["instagram"],
        "instagram_positions": ["shop"],
    },
    "AUDIENCE_NETWORK": {
        "publisher_platforms": ["audience_network"],
        "audience_network_positions": ["classic", "instream_video"],
    },
}


def _translate_asset_customization_rules(
    rules: List[Dict[str, Any]],
    images_array: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Translate user-friendly placement_groups format to Meta API format.

    Our user-facing format:
        [{"placement_groups": ["FEED"], "customization_spec": {"image_hashes": ["h1"]}},
         {"placement_groups": ["STORY"], "customization_spec": {"image_hashes": ["h2"]}}]

    Meta API format:
        [{"customization_spec": {"publisher_platforms": [...], "facebook_positions": [...]},
          "image_label": {"name": "PBOARD_IMG_0"}},
         ...]
    And images in asset_feed_spec.images get adlabels assigned.

    Rules that do NOT contain placement_groups are passed through unchanged
    (allows raw Meta API format to be used directly).
    """
    if not rules or not any("placement_groups" in r for r in rules):
        return rules, images_array

    # Build hash → label mapping across all rules
    hash_to_label: Dict[str, str] = {}
    label_counter = 0

    translated_rules = []
    for rule in rules:
        if "placement_groups" not in rule:
            translated_rules.append(rule)
            continue

        placement_groups = rule.get("placement_groups", [])
        cspec_input = rule.get("customization_spec", {})

        # Build Meta-format customization_spec from placement_groups
        publisher_platforms: set = set()
        facebook_positions: set = set()
        instagram_positions: set = set()
        audience_network_positions: set = set()

        for pg in placement_groups:
            mapping = _PLACEMENT_GROUP_TO_POSITIONS.get(pg, {})
            publisher_platforms.update(mapping.get("publisher_platforms", []))
            facebook_positions.update(mapping.get("facebook_positions", []))
            instagram_positions.update(mapping.get("instagram_positions", []))
            audience_network_positions.update(mapping.get("audience_network_positions", []))

        meta_cspec: Dict[str, Any] = {}
        if publisher_platforms:
            meta_cspec["publisher_platforms"] = sorted(publisher_platforms)
        if facebook_positions:
            meta_cspec["facebook_positions"] = sorted(facebook_positions)
        if instagram_positions:
            meta_cspec["instagram_positions"] = sorted(instagram_positions)
        if audience_network_positions:
            meta_cspec["audience_network_positions"] = sorted(audience_network_positions)

        # Carry over text overrides (bodies, titles, etc.) into customization_spec
        for text_field in ("bodies", "titles", "descriptions", "link_urls", "call_to_action_types"):
            if text_field in cspec_input:
                meta_cspec[text_field] = cspec_input[text_field]

        translated_rule: Dict[str, Any] = {"customization_spec": meta_cspec}

        # Assign label for image or video asset
        img_hashes = cspec_input.get("image_hashes", [])
        vid_ids = cspec_input.get("video_ids", [])
        if img_hashes:
            h = img_hashes[0]
            if h not in hash_to_label:
                hash_to_label[h] = f"PBOARD_IMG_{label_counter}"
                label_counter += 1
            translated_rule["image_label"] = {"name": hash_to_label[h]}
        elif vid_ids:
            v = vid_ids[0]
            if v not in hash_to_label:
                hash_to_label[v] = f"PBOARD_VID_{label_counter}"
                label_counter += 1
            translated_rule["video_label"] = {"name": hash_to_label[v]}

        translated_rules.append(translated_rule)

    # Add adlabels to images_array for referenced hashes
    updated_images = []
    for img in images_array:
        img_hash = img.get("hash", "")
        if img_hash in hash_to_label:
            updated = dict(img)
            updated["adlabels"] = [{"name": hash_to_label[img_hash]}]
            updated_images.append(updated)
        else:
            updated_images.append(img)

    return translated_rules, updated_images


# All writable creative_features_spec keys for Meta Ads API v24+.
# Mirrors ALL_ENHANCEMENT_KEYS in pipeboard.co/lib/meta-ads-enhancement-keys.ts.
# Setting each key to {"enroll_status": "OPT_OUT"} disables the enhancement.
# NOTE: The legacy "standard_enhancements" key is deprecated for POST operations
# (Meta error subcode 3858504) — individual keys must be used instead.
_ALL_ENHANCEMENT_KEYS: tuple[str, ...] = (
    "add_text_overlay",
    "creative_stickers",
    "description_automation",
    "image_animation",
    "image_background_gen",
    "image_templates",
    "image_touchups",
    "image_uncrop",
    "inline_comment",
    "media_type_automation",
    "music_generation",
    "pac_relaxation",
    "product_extensions",
    "profile_card",
    "reveal_details_over_time",
    "show_destination_blurbs",
    "show_summary",
    "site_extensions",
    "text_optimizations",
    "text_translation",
    "translate_voiceover",
    "video_auto_crop",
    "video_highlights",
)


def _strip_deprecated_standard_enhancements(creative: Dict[str, Any]) -> None:
    """Drop the deprecated standard_enhancements key from a creative dict in place.

    Meta still emits `standard_enhancements` inside `creative_features_spec` on GET
    responses but rejects it on POST with error_subcode 3858504. LLMs frequently copy
    GET responses straight into the next mutation, so stripping it here prevents the
    deprecated field from being re-introduced via the model.
    """
    if not isinstance(creative, dict):
        return
    cfs = creative.get("creative_features_spec")
    if isinstance(cfs, dict):
        cfs.pop("standard_enhancements", None)
    dof = creative.get("degrees_of_freedom_spec")
    if isinstance(dof, dict):
        dof_cfs = dof.get("creative_features_spec")
        if isinstance(dof_cfs, dict):
            dof_cfs.pop("standard_enhancements", None)


def _translate_video_customization_rules(
    rules: List[Dict[str, Any]],
    videos_array: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Translate user-friendly placement_groups format to Meta API format for videos[].

    Parallels `_translate_asset_customization_rules` (which handles the images[] path).
    When callers pass `videos=[...]` with placement_groups-style rules, the rules and
    videos_array need to be rewritten into the shape Meta expects:

    Our user-facing format:
        videos_array = [{"video_id": "A"}, {"video_id": "B"}]
        rules = [
            {"placement_groups": ["FEED"], "customization_spec": {"video_ids": ["A"]}},
            {"placement_groups": ["STORY"], "customization_spec": {"video_ids": ["B"]}}
        ]

    Meta API format:
        videos_array = [
            {"video_id": "A", "adlabels": [{"name": "PBOARD_VID_0"}]},
            {"video_id": "B", "adlabels": [{"name": "PBOARD_VID_1"}]}
        ]
        rules = [
            {"customization_spec": {"publisher_platforms": [...], "facebook_positions": [...]},
             "video_label": {"name": "PBOARD_VID_0"}},
            ...
        ]

    Also tolerates `customization_spec.video_label: "str"` (string) by hoisting it to
    `video_label: {"name": "str"}` at the rule level. Existing adlabels on
    videos_array entries (e.g., user-supplied via `videos[].label`) are preserved,
    and the rule's video_label reuses that existing adlabel name so the rule points
    at the asset the caller labeled (Meta rejects the creative with error_subcode
    2446173 "Target rule label ... doesn't refer to any of the asset labels" if
    the rule references a label that isn't on any asset).

    Rules that do NOT contain placement_groups are passed through unchanged.
    """
    if not rules or not any("placement_groups" in r for r in rules):
        return rules, videos_array

    existing_vid_to_label: Dict[str, str] = {}
    for v in videos_array:
        vid_id = str(v.get("video_id", ""))
        adlabels = v.get("adlabels")
        if vid_id and vid_id not in existing_vid_to_label and isinstance(adlabels, list) and adlabels:
            first = adlabels[0]
            if isinstance(first, dict) and isinstance(first.get("name"), str):
                existing_vid_to_label[vid_id] = first["name"]

    vid_to_label: Dict[str, str] = {}
    label_counter = 0
    translated_rules: List[Dict[str, Any]] = []

    for rule in rules:
        if "placement_groups" not in rule:
            translated_rules.append(rule)
            continue

        placement_groups = rule.get("placement_groups", [])
        cspec_input = rule.get("customization_spec", {})

        # Build Meta-format customization_spec from placement_groups
        publisher_platforms: set = set()
        facebook_positions: set = set()
        instagram_positions: set = set()
        audience_network_positions: set = set()

        for pg in placement_groups:
            mapping = _PLACEMENT_GROUP_TO_POSITIONS.get(pg, {})
            publisher_platforms.update(mapping.get("publisher_platforms", []))
            facebook_positions.update(mapping.get("facebook_positions", []))
            instagram_positions.update(mapping.get("instagram_positions", []))
            audience_network_positions.update(mapping.get("audience_network_positions", []))

        meta_cspec: Dict[str, Any] = {}
        if publisher_platforms:
            meta_cspec["publisher_platforms"] = sorted(publisher_platforms)
        if facebook_positions:
            meta_cspec["facebook_positions"] = sorted(facebook_positions)
        if instagram_positions:
            meta_cspec["instagram_positions"] = sorted(instagram_positions)
        if audience_network_positions:
            meta_cspec["audience_network_positions"] = sorted(audience_network_positions)

        # Carry over text overrides into customization_spec
        for text_field in ("bodies", "titles", "descriptions", "link_urls", "call_to_action_types"):
            if text_field in cspec_input:
                meta_cspec[text_field] = cspec_input[text_field]

        translated_rule: Dict[str, Any] = {"customization_spec": meta_cspec}

        # Assign video_label at the rule level. Precedence:
        #   1) customization_spec.video_ids: [id] — map id → label. Reuse the
        #      explicit adlabel already on the matching videos_array entry (from
        #      videos[].label) so rule labels match asset labels; otherwise mint
        #      a PBOARD_VID_N and stamp it on the video.
        #   2) customization_spec.video_label: "str" — coerce string to {"name": str}
        #   3) customization_spec.video_label: {"name": "str"} — pass through
        vid_ids = cspec_input.get("video_ids", [])
        raw_video_label = cspec_input.get("video_label")
        if vid_ids:
            v = str(vid_ids[0])
            if v not in vid_to_label:
                if v in existing_vid_to_label:
                    vid_to_label[v] = existing_vid_to_label[v]
                else:
                    vid_to_label[v] = f"PBOARD_VID_{label_counter}"
                    label_counter += 1
            translated_rule["video_label"] = {"name": vid_to_label[v]}
        elif isinstance(raw_video_label, str):
            translated_rule["video_label"] = {"name": raw_video_label}
        elif isinstance(raw_video_label, dict):
            translated_rule["video_label"] = raw_video_label

        translated_rules.append(translated_rule)

    # Stamp adlabels onto videos_array entries for video_ids that were referenced
    # by rules. Only applies to videos without existing adlabels — explicit user
    # labels (from videos[].label) win, and the rule's video_label was already
    # aligned to that label above.
    updated_videos: List[Dict[str, Any]] = []
    for v in videos_array:
        vid_id = str(v.get("video_id", ""))
        if vid_id in vid_to_label and "adlabels" not in v:
            updated = dict(v)
            updated["adlabels"] = [{"name": vid_to_label[vid_id]}]
            updated_videos.append(updated)
        else:
            updated_videos.append(v)

    return translated_rules, updated_videos


def _translate_video_customization_rules_for_existing_post(
    rules: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Translate placement_groups-format customization rules to Meta API format,
    building a videos array for use alongside object_story_id.

    Used when object_story_id is combined with asset_customization_rules
    to override specific placements (e.g., a 9:16 video for Story/Reels
    while the organic post shows in feed).

    Our user-facing format:
        [{"placement_groups": ["STORY"], "customization_spec": {"video_ids": ["vid123"]}}]

    Meta API format in asset_feed_spec:
        videos: [{"video_id": "vid123", "adlabels": [{"name": "PBOARD_VID_0"}]}]
        asset_customization_rules: [
            {"customization_spec": {"publisher_platforms": [...], "instagram_positions": ["story"], ...},
             "video_label": {"name": "PBOARD_VID_0"}}
        ]

    Rules that do NOT contain placement_groups are passed through unchanged
    (allows raw Meta API format to be used directly).

    Returns:
        (translated_rules, videos_array) where videos_array has adlabels assigned.
    """
    if not rules or not any("placement_groups" in r for r in rules):
        # Pass through raw rules if already in Meta API format
        return rules, []

    vid_to_label: Dict[str, str] = {}
    label_counter = 0
    translated_rules = []

    for rule in rules:
        if "placement_groups" not in rule:
            translated_rules.append(rule)
            continue

        placement_groups = rule.get("placement_groups", [])
        cspec_input = rule.get("customization_spec", {})

        # Build Meta-format customization_spec from placement_groups
        publisher_platforms: set = set()
        facebook_positions: set = set()
        instagram_positions: set = set()
        audience_network_positions: set = set()

        for pg in placement_groups:
            mapping = _PLACEMENT_GROUP_TO_POSITIONS.get(pg, {})
            publisher_platforms.update(mapping.get("publisher_platforms", []))
            facebook_positions.update(mapping.get("facebook_positions", []))
            instagram_positions.update(mapping.get("instagram_positions", []))
            audience_network_positions.update(mapping.get("audience_network_positions", []))

        meta_cspec: Dict[str, Any] = {}
        if publisher_platforms:
            meta_cspec["publisher_platforms"] = sorted(publisher_platforms)
        if facebook_positions:
            meta_cspec["facebook_positions"] = sorted(facebook_positions)
        if instagram_positions:
            meta_cspec["instagram_positions"] = sorted(instagram_positions)
        if audience_network_positions:
            meta_cspec["audience_network_positions"] = sorted(audience_network_positions)

        # Carry over text overrides into customization_spec
        for text_field in ("bodies", "titles", "descriptions", "link_urls", "call_to_action_types"):
            if text_field in cspec_input:
                meta_cspec[text_field] = cspec_input[text_field]

        translated_rule: Dict[str, Any] = {"customization_spec": meta_cspec}

        # Assign label for video asset
        vid_ids = cspec_input.get("video_ids", [])
        if vid_ids:
            v = vid_ids[0]
            if v not in vid_to_label:
                vid_to_label[v] = f"PBOARD_VID_{label_counter}"
                label_counter += 1
            translated_rule["video_label"] = {"name": vid_to_label[v]}

        translated_rules.append(translated_rule)

    # Build videos_array with adlabels
    videos_array = [
        {"video_id": vid_id, "adlabels": [{"name": label}]}
        for vid_id, label in vid_to_label.items()
    ]

    return translated_rules, videos_array


def _normalize_text_variants(items: Optional[List[Any]]) -> Optional[List[Dict[str, Any]]]:
    if not items:
        return None
    out: List[Dict[str, Any]] = []
    for item in items:
        if isinstance(item, dict) and 'text' in item:
            out.append(item)
        else:
            out.append({'text': str(item)})
    return out


def extract_creative_image_urls(creative: Dict[str, Any]) -> List[str]:
    """Extract image URLs from a creative object (reference_ads/meta_ads/utils.py)."""
    image_urls: List[str] = []
    if creative.get('image_urls_for_viewing'):
        image_urls.extend(creative['image_urls_for_viewing'])
    if creative.get('image_url'):
        image_urls.append(creative['image_url'])
    story_spec = creative.get('object_story_spec') or {}
    link_data = story_spec.get('link_data') or {}
    if link_data.get('picture'):
        image_urls.append(link_data['picture'])
    if link_data.get('image_url'):
        image_urls.append(link_data['image_url'])
    video_data = story_spec.get('video_data') or {}
    if video_data.get('image_url'):
        image_urls.append(video_data['image_url'])
    afs = creative.get('asset_feed_spec') or {}
    for image in afs.get('images') or []:
        if image.get('url'):
            image_urls.append(image['url'])
    if creative.get('thumbnail_url'):
        image_urls.append(creative['thumbnail_url'])
    seen: set = set()
    unique: List[str] = []
    for url in image_urls:
        if url and url not in seen:
            seen.add(url)
            unique.append(url)
    return unique

