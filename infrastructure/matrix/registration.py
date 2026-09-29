"""Reserve product identities without excluding humans from native push rules."""

import re

from synapse.spam_checker_api import RegistrationBehaviour
from synapse.module_api import NOT_SPAM
from synapse.api.errors import Codes


class ReservedIdentities:
    def __init__(self, config, api):
        self.server_name = api.server_name
        api.register_spam_checker_callbacks(
            check_registration_for_spam=self.check_registration,
            check_login_for_spam=self.check_login,
        )

    async def check_registration(
        self, email_threepid, username, request_info, auth_provider_id=None
    ):
        # Applies to password and SSO registration. Authenticated application-service
        # registration has its own native namespace check and does not call this hook.
        if username and re.fullmatch(r"_zoen_[a-f0-9]{32}", username):
            return RegistrationBehaviour.DENY
        return RegistrationBehaviour.ALLOW

    async def check_login(
        self,
        user_id,
        device_id,
        initial_display_name,
        request_info,
        auth_provider_id=None,
    ):
        # Prevent an SSO mapper from linking an existing infrastructure identity.
        # The bridge uses its service token directly, never interactive login.
        if re.fullmatch(
            r"@_zoen_(?:[a-f0-9]{32}|bot|agent_[a-f0-9]{32}):"
            + re.escape(self.server_name),
            user_id,
        ):
            return Codes.FORBIDDEN
        return NOT_SPAM
