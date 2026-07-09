#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""EPCR client / tracker 單元測試（不需真實 token）。"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import epcr_client as client
import epcr_tracker as tr


def setup_function():
    tr.TRAILS.clear()
    tr.PUSHED.clear()
    tr.DISPATCHES.clear()


def test_extract_gps_coords_row():
    row = {
        "Ambulance": {
            "code": "更寮91",
            "licenseNo": "ABC-1234",
            "Branch": {"name": "更寮分隊"},
            "Devices": [{
                "currentlatitude": 25.01,
                "currentlongitude": 121.45,
                "updatedAt": "2026-07-09T16:00:00.000Z",
            }],
        }
    }
    p = client.extract_gps_from_coords_row(row)
    assert p is not None
    assert p["code"] == "更寮91"
    assert abs(p["lat"] - 25.01) < 1e-6
    assert p["branch"] == "更寮分隊"


def test_merge_prefers_newer():
    coords = [{
        "Ambulance": {
            "code": "板橋11",
            "Devices": [{
                "currentlatitude": 25.0,
                "currentlongitude": 121.4,
                "updatedAt": "2026-07-09T10:00:00Z",
            }],
        }
    }]
    devices = [{
        "code": "板橋11",
        "currentlatitude": 25.02,
        "currentlongitude": 121.42,
        "updatedAt": "2026-07-09T12:00:00Z",
    }]
    now = time.mktime(time.strptime("2026-07-09 12:05:00", "%Y-%m-%d %H:%M:%S"))
    m = client.merge_gps_points(coords, devices, max_age_sec=7200, now=now)
    assert "板橋11" in m
    assert abs(m["板橋11"]["lat"] - 25.02) < 1e-6
    assert m["板橋11"]["source"] == "Devices"


def test_extract_dispatch_summary():
    d = {
        "uuid": "abc-def-123",
        "StatusId": 6,
        "Ambulance": {"code": "永和91"},
        "address": "新北市永和區永和路一段1號",
        "departedAt": "2026-07-09T08:00:00Z",
        "arrivedAt": None,
        "latitude": 25.007,
        "longitude": 121.514,
    }
    s = client.extract_dispatch_summary(d)
    assert s["uuid"] == "abc-def-123"
    assert s["status_id"] == 6
    assert s["ambulance_code"] == "永和91"
    assert "永和" in s["address"]
    assert s["departed_ts"] is not None
    assert s["arrived_ts"] is None


def test_classify_departed_and_arrived():
    setup_function()
    summary = {
        "uuid": "u1",
        "ambulance_code": "測試91",
        "status_id": 6,
        "address": "新北市板橋區",
        "departed_ts": time.time() - 100,
        "arrived_ts": None,
        "left_ts": None,
        "scene_lat": 25.0,
        "scene_lng": 121.5,
    }
    phases = tr.classify_dispatch_phases(summary, gps=None)
    assert tr.LEVEL_DEPARTED in phases
    assert tr.LEVEL_ARRIVED not in phases

    summary2 = dict(summary)
    summary2["arrived_ts"] = time.time()
    phases2 = tr.classify_dispatch_phases(summary2)
    assert tr.LEVEL_ARRIVED in phases2


def test_no_arrive_after_left_hospital():
    setup_function()
    summary = {
        "uuid": "u2",
        "ambulance_code": "測試92",
        "status_id": 7,
        "departed_ts": time.time() - 200,
        "arrived_ts": time.time() - 100,
        "left_ts": time.time() - 10,
        "scene_lat": 25.0,
        "scene_lng": 121.5,
    }
    tr.mark_pushed("u2", tr.LEVEL_DEPARTED, "測試92")
    phases = tr.classify_dispatch_phases(summary)
    assert tr.LEVEL_ARRIVED not in phases


def test_gps_near_scene_arrive():
    setup_function()
    tr.TRAILS["近場91"] = [
        (time.time() - 30, 25.001, 121.501),
        (time.time() - 20, 25.0005, 121.5005),
        (time.time() - 5, 25.0001, 121.5001),
    ]
    summary = {
        "uuid": "u3",
        "ambulance_code": "近場91",
        "status_id": 6,
        "departed_ts": time.time() - 60,
        "arrived_ts": None,
        "left_ts": None,
        "scene_lat": 25.0,
        "scene_lng": 121.5,
    }
    gps = {"code": "近場91", "lat": 25.0001, "lng": 121.5001}
    phases = tr.classify_dispatch_phases(summary, gps=gps)
    assert tr.LEVEL_ARRIVED in phases


def test_build_payload():
    setup_function()
    summary = {
        "uuid": "uuid-xxxx",
        "ambulance_code": "板橋91",
        "status_id": 5,
        "address": "新北市板橋區文化路",
        "departed_ts": time.time(),
        "scene_lat": 25.01,
        "scene_lng": 121.46,
    }
    gps = {"code": "板橋91", "lat": 25.012, "lng": 121.462, "branch": "板橋"}
    p = tr.build_epcr_payload(summary, tr.LEVEL_DEPARTED, gps=gps)
    assert p["_push_source"] == "ntpc-epcr"
    assert "往現場" in p["text"]
    assert "板橋91" in p["text"]


def test_parse_iso():
    ts = client.parse_iso_ts("2026-07-09T08:30:00Z")
    assert ts is not None
    assert ts > 1e9


if __name__ == "__main__":
    test_extract_gps_coords_row()
    test_merge_prefers_newer()
    test_extract_dispatch_summary()
    test_classify_departed_and_arrived()
    test_no_arrive_after_left_hospital()
    test_gps_near_scene_arrive()
    test_build_payload()
    test_parse_iso()
    print("ALL TESTS PASSED")
