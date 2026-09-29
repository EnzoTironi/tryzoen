"""Run inside the pinned Synapse image: registration-check.py <guard directory>.

Starts its own loopback-only SQLite homeserver, never resets a running service.
All identities and credentials below are synthetic; the child is always reaped.
"""

import json, os, time, uuid, urllib.request, urllib.parse, subprocess, sys, pathlib
from signedjson.key import generate_signing_key, write_signing_keys
import yaml

guard_directory = str(pathlib.Path(sys.argv[1]).resolve())
probe_directory = str(pathlib.Path(__file__).resolve().parent)
root = pathlib.Path("/tmp/zoen-unread-spike-" + uuid.uuid4().hex)
root.mkdir(mode=448)
server = "zoen-unread.invalid"
token = "synthetic-native-spike-only"
base = "http://127.0.0.1:18019/_matrix/client/v3/"
with open(root / "signing.key", "w") as f:
    write_signing_keys(f, [generate_signing_key("spike")])
reg = {
    "id": "zoen-unread-spike",
    "as_token": token,
    "hs_token": "synthetic-hs-spike-only",
    "sender_localpart": "_zoen_bot",
    "url": None,
    "rate_limited": False,
    "namespaces": {
        "users": [
            {
                "exclusive": True,
                "regex": "^@_zoen_(bot|agent_[a-f0-9]{32}):zoen-unread\\.invalid$",
            },
            {
                "exclusive": False,
                "regex": "^@_zoen_[a-f0-9]{32}:zoen-unread\\.invalid$",
            },
        ],
        "aliases": [],
        "rooms": [],
    },
}
(root / "registration.yaml").write_text(yaml.safe_dump(reg))
config = {
    "server_name": server,
    "signing_key_path": str(root / "signing.key"),
    "report_stats": False,
    "pid_file": str(root / "pid"),
    "listeners": [
        {
            "port": 18019,
            "type": "http",
            "tls": False,
            "bind_addresses": ["127.0.0.1"],
            "resources": [{"names": ["client", "health"]}],
        }
    ],
    "database": {"name": "sqlite3", "args": {"database": str(root / "sqlite.db")}},
    "app_service_config_files": [str(root / "registration.yaml")],
    "trusted_key_servers": [],
    "suppress_key_server_warning": True,
    "federation_domain_whitelist": [],
    "enable_registration": False,
    "enable_media_repo": False,
    "rc_message": {"per_second": 1000, "burst_count": 10000},
}
config["modules"] = [
    {"module": "registration.ReservedIdentities", "config": {}},
    {
        "module": "registration_probe.Proof",
        "config": {"output": str(root / "proof.json")},
    },
]
(root / "homeserver.yaml").write_text(yaml.safe_dump(config))
log = open(root / "server.log", "w")
proc = subprocess.Popen(
    [
        sys.executable,
        "-m",
        "synapse.app.homeserver",
        "--config-path",
        str(root / "homeserver.yaml"),
    ],
    stdout=log,
    stderr=log,
    env={**os.environ, "PYTHONPATH": guard_directory + ":" + probe_directory},
)


def req(method, path, body=None, user=None):
    sep = "&" if "?" in path else "?"
    if user:
        path += sep + "user_id=" + urllib.parse.quote(user, safe="")
    r = urllib.request.Request(
        base + path,
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(r, timeout=15) as response:
        return json.load(response)


def enc(x):
    return urllib.parse.quote(x, safe="")


try:
    for i in range(80):
        try:
            req("GET", "capabilities")
            break
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError(
                    "isolated Synapse failed to start; private log "
                    + str(root / "server.log")
                )
            time.sleep(0.25)
    registration_checks = {}
    for name in [
        "ordinary_person",
        "_zoen_bad",
        "_zoen_" + "d" * 31,
        "_zoen_" + "d" * 33,
    ]:
        try:
            req(
                "POST",
                "register",
                {
                    "type": "m.login.application_service",
                    "username": name,
                    "inhibit_login": True,
                },
            )
            registration_checks[name] = "UNEXPECTED_ALLOWED"
        except urllib.error.HTTPError as e:
            registration_checks[name] = json.load(e).get("errcode")
    raw = urllib.request.Request(
        base + "register",
        data=json.dumps(
            {"username": "ordinary_person", "password": "synthetic-spike-only"}
        ).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(raw)
        registration_checks["public"] = "UNEXPECTED_ALLOWED"
    except urllib.error.HTTPError as e:
        registration_checks["public"] = json.load(e).get("errcode")
    users = []
    for name in [
        "_zoen_agent_" + "a" * 32,
        "_zoen_agent_" + "b" * 32,
        "_zoen_" + "c" * 32,
    ]:
        users.append(
            req(
                "POST",
                "register",
                {
                    "type": "m.login.application_service",
                    "username": name,
                    "inhibit_login": True,
                },
            )["user_id"]
        )
    author, control, viewer = users
    room = req(
        "POST",
        "createRoom",
        {"preset": "private_chat", "invite": [control, viewer]},
        author,
    )["room_id"]
    for user in [control, viewer]:
        req("POST", "join/" + enc(room), {}, user)
        req("PUT", "devices/SPIKE", {"display_name": "Synthetic attention probe"}, user)

    def send(body, extra=None):
        return req(
            "PUT",
            "rooms/" + enc(room) + "/send/m.room.message/" + uuid.uuid4().hex,
            {"msgtype": "m.text", "body": body, **(extra or {})},
            author,
        )["event_id"]

    def receipt(user, event, thread="main"):
        req(
            "POST",
            "rooms/" + enc(room) + "/receipt/m.read.private/" + enc(event),
            {"thread_id": thread},
            user,
        )

    filter = enc(
        json.dumps(
            {
                "room": {
                    "rooms": [room],
                    "timeline": {"limit": 1, "unread_thread_notifications": True},
                },
                "presence": {"types": []},
            }
        )
    )
    cursors = {}

    def sync(user):
        path = "sync?device_id=SPIKE&timeout=0&filter=" + filter
        if user in cursors:
            path += "&since=" + enc(cursors[user])
        value = req("GET", path, user=user)
        cursors[user] = value["next_batch"]
        return value.get("rooms", {}).get("join", {}).get(room, {})

    def counts(user):
        last = {}
        for _ in range(3):
            value = sync(user)
            if "unread_notifications" in value:
                last = value
            time.sleep(0.08)
        return {
            key: last.get(key)
            for key in [
                "unread_notifications",
                "unread_thread_notifications",
                "org.matrix.msc2654.unread_count",
            ]
        }

    baseline = send("baseline")
    for user in [control, viewer]:
        receipt(user, baseline)
        sync(user)
    plain = send("ordinary unread message")
    time.sleep(0.2)
    out = {
        "registration": registration_checks,
        "plain": {"exclusive": counts(control), "nonexclusive": counts(viewer)},
    }
    mention = send("explicit mention", {"m.mentions": {"user_ids": [viewer, control]}})
    time.sleep(0.2)
    out["mention"] = {"exclusive": counts(control), "nonexclusive": counts(viewer)}
    receipt(viewer, mention)
    time.sleep(0.2)
    out["after_private_main_receipt"] = counts(viewer)
    root_event = send("thread root")
    receipt(viewer, root_event)
    reply = send(
        "thread reply",
        {
            "m.relates_to": {
                "rel_type": "m.thread",
                "event_id": root_event,
                "is_falling_back": True,
                "m.in_reply_to": {"event_id": root_event},
            }
        },
    )
    time.sleep(0.2)
    out["thread_reply"] = counts(viewer)
    receipt(viewer, reply, root_event)
    time.sleep(0.2)
    out["after_private_thread_receipt"] = counts(viewer)
    room = req(
        "POST",
        "createRoom",
        {"preset": "private_chat", "is_direct": True, "invite": [viewer]},
        author,
    )["room_id"]
    req("POST", "join/" + enc(room), {}, viewer)
    filter = enc(
        json.dumps(
            {
                "room": {
                    "rooms": [room],
                    "timeline": {"limit": 1, "unread_thread_notifications": True},
                },
                "presence": {"types": []},
            }
        )
    )
    cursors = {}
    baseline = send("direct baseline")
    receipt(viewer, baseline)
    sync(viewer)
    direct = send("direct unread")
    time.sleep(0.2)
    out["direct_message"] = counts(viewer)
    receipt(viewer, direct)
    time.sleep(0.2)
    out["after_direct_private_receipt"] = counts(viewer)
    req(
        "PUT",
        "pushrules/global/room/" + enc(room),
        {"actions": ["dont_notify"]},
        viewer,
    )
    send("muted direct message")
    time.sleep(0.2)
    out["muted_direct_message"] = counts(viewer)
    for _ in range(30):
        if (root / "proof.json").exists():
            break
        time.sleep(0.2)
    out["guard"] = json.loads((root / "proof.json").read_text())
    assert out["guard"]["normal_human"]["code"] == 429
    assert out["guard"]["sso_human"]["code"] == 429
    assert out["guard"]["normal_bot"]["errcode"] == "M_INVALID_USERNAME"
    assert out["guard"]["normal_agent"]["errcode"] == "M_INVALID_USERNAME"
    assert out["guard"]["ordinary"] == "allowed"
    assert out["guard"]["sso_ordinary"] == "allowed"
    for login in ["login_human", "sso_login_human", "sso_login_agent"]:
        assert out["guard"][login] == {"code": 403, "errcode": "M_FORBIDDEN"}
    assert out["guard"]["login_ordinary"] == "allowed"
    assert (
        out["plain"]["nonexclusive"]["unread_notifications"]["notification_count"] == 1
    )
    assert (
        out["mention"]["nonexclusive"]["unread_notifications"]["highlight_count"] == 1
    )
    assert (
        out["after_private_main_receipt"]["unread_notifications"]["notification_count"]
        == 0
    )
    assert out["direct_message"]["unread_notifications"]["notification_count"] == 1
    assert (
        out["after_direct_private_receipt"]["unread_notifications"][
            "notification_count"
        ]
        == 0
    )
    assert (
        out["muted_direct_message"]["unread_notifications"]["notification_count"] == 0
    )
    print(json.dumps(out, indent=2))
finally:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    log.close()
