"""Test-only driver for real Synapse password/SSO registration paths."""

import json
from pathlib import Path
from synapse.api.errors import SynapseError
from synapse.handlers.sso import UserAttributes
from synapse.http.site import RequestInfo
from synapse.rest.client.login import LoginRestServlet


class Proof:

    def __init__(self, config, api):
        self.done = False

        async def run():
            if self.done:
                return
            self.done = True
            hs = api._hs
            registration = hs.get_registration_handler()
            sso = hs.get_sso_handler()
            login = LoginRestServlet(hs)
            reserved, _ = await registration.appservice_register(
                "_zoen_" + "4" * 32, "synthetic-native-spike-only"
            )
            reserved_agent, _ = await registration.appservice_register(
                "_zoen_agent_" + "5" * 32, "synthetic-native-spike-only"
            )
            result = {}
            calls = {
                "normal_human": lambda: registration.register_user(
                    localpart="_zoen_" + "1" * 32
                ),
                "sso_human": lambda: sso._register_mapped_user(
                    UserAttributes(localpart="_zoen_" + "2" * 32),
                    "synthetic-sso",
                    "synthetic-remote",
                    "test",
                    "127.0.0.1",
                ),
                "normal_bot": lambda: registration.register_user(localpart="_zoen_bot"),
                "normal_agent": lambda: registration.register_user(
                    localpart="_zoen_agent_" + "3" * 32
                ),
                "ordinary": lambda: registration.register_user(
                    localpart="ordinary_test"
                ),
                "sso_ordinary": lambda: sso._register_mapped_user(
                    UserAttributes(localpart="sso_test"),
                    "synthetic-sso",
                    "ordinary-remote",
                    "test",
                    "127.0.0.1",
                ),
            }
            for key, call in calls.items():
                try:
                    await call()
                    result[key] = "allowed"
                except SynapseError as error:
                    result[key] = {"code": error.code, "errcode": error.errcode}
            # Exercise the final native login gate, including existing-account SSO
            # linking. Test-only use of the handler prevents needing a real IdP.
            for key, user_id, provider in [
                ("login_human", reserved, None),
                ("sso_login_human", reserved, "synthetic-sso"),
                ("sso_login_agent", reserved_agent, "synthetic-sso"),
                ("login_ordinary", "@ordinary_test:" + hs.hostname, None),
            ]:
                try:
                    await login._complete_login(
                        user_id,
                        {},
                        ratelimit=False,
                        auth_provider_id=provider,
                        request_info=RequestInfo("synthetic-check", "127.0.0.1"),
                    )
                    result[key] = "allowed"
                except SynapseError as error:
                    result[key] = {"code": error.code, "errcode": error.errcode}
            Path(config["output"]).write_text(json.dumps(result))

        api.looping_background_call(run, 1000)
