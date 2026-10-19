"""Config flow for TaskTick.

Three ways in, and they share one validation step:

* **Zeroconf** — TaskTick advertises ``_tasktick._tcp.local.`` and puts the
  address you actually browse to in its TXT record. Behind a reverse proxy that
  is not the host the SRV record points at (the container advertises its bridge
  IP), which is precisely why the TXT record exists. Discovery fills the URL in
  and stops; the API token is a secret only the user has, so there is nothing to
  discover about it.
* **User** — typed by hand, for an instance on another network or behind a proxy
  that filters multicast.
* **Reauth** — the token was rotated or revoked, and the coordinator raised
  ``ConfigEntryAuthFailed``.

The URL is normalised before it is validated or stored, so ``tasks.example.com``
and ``https://tasks.example.com/`` end up as the same unique ID and cannot be
configured twice.
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_URL
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    BooleanSelector,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import (
    TaskTickAuthError,
    TaskTickClient,
    TaskTickConnectionError,
    TaskTickError,
    normalize_url,
    origin_of,
)
from .const import (
    CONF_TOKEN,
    CONF_VERIFY_SSL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    TXT_PATH,
    TXT_URL,
    ZEROCONF_TYPE,
)

_LOGGER = logging.getLogger(__name__)

MIN_SCAN_SECONDS = 15
MAX_SCAN_SECONDS = 3600


def _schema(defaults: dict[str, Any] | None = None) -> vol.Schema:
    defaults = defaults or {}
    return vol.Schema(
        {
            vol.Required(CONF_URL, default=defaults.get(CONF_URL, "")): TextSelector(
                TextSelectorConfig(type=TextSelectorType.URL)
            ),
            vol.Required(CONF_TOKEN): TextSelector(
                TextSelectorConfig(type=TextSelectorType.PASSWORD)
            ),
            vol.Optional(CONF_VERIFY_SSL, default=defaults.get(CONF_VERIFY_SSL, True)): BooleanSelector(),
        }
    )


async def _validate(hass, url: str, token: str, verify_ssl: bool) -> dict[str, Any]:
    """Normalise, then prove the token by fetching the account.

    Returns the account so the caller can name the entry after it.
    """
    client = TaskTickClient(async_get_clientsession(hass), url, token, verify_ssl=verify_ssl)
    return await client.async_validate()


class TaskTickConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for TaskTick."""

    VERSION = 1

    def __init__(self) -> None:
        self._discovered: dict[str, Any] = {}
        self._reauth_entry: ConfigEntry | None = None

    # -- discovery -------------------------------------------------------- #

    async def async_step_zeroconf(self, discovery_info: Any) -> ConfigFlowResult:
        """A TaskTick instance answered on the local network."""
        properties = dict(getattr(discovery_info, "properties", None) or {})

        # The TXT `url` is the browsable address. Falling back to host:port is
        # the best guess when an older server did not send one — it will be the
        # container's own address, which usually will not route, but the user can
        # correct it in the form we are about to show.
        url = properties.get(TXT_URL) or ""
        if not url:
            host = getattr(discovery_info, "host", None)
            port = getattr(discovery_info, "port")
            if host and port:
                url = f"https://{host}:{port}"

        path = properties.get(TXT_PATH) or ""
        if url and path and not url.endswith(path):
            url = f"{url.rstrip('/')}{path}"

        try:
            normalized = normalize_url(url)
        except ValueError:
            _LOGGER.debug("ignoring zeroconf advertisement with unusable url %r", url)
            return self.async_abort(reason="cannot_connect")

        await self.async_set_unique_id(normalized)
        self._abort_if_unique_id_configured()

        self._discovered = {CONF_URL: normalized}
        self.context["title_placeholders"] = {"name": origin_of(normalized)}
        return await self.async_step_zeroconf_confirm()

    async def async_step_zeroconf_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Confirm the discovered address and ask for the token."""
        if user_input is not None:
            return await self._async_create(user_input)

        return self.async_show_form(
            step_id="zeroconf_confirm",
            data_schema=_schema(self._discovered),
            description_placeholders={"url": self._discovered.get(CONF_URL, "")},
        )

    # -- manual ----------------------------------------------------------- #

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return await self._async_create(user_input)

        return self.async_show_form(step_id="user", data_schema=_schema())

    # -- reauth ----------------------------------------------------------- #

    async def async_step_reauth(self, entry_data: dict[str, Any]) -> ConfigFlowResult:
        self._reauth_entry = self._get_reauth_entry()
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        assert self._reauth_entry is not None
        errors: dict[str, str] = {}

        if user_input is not None:
            url = self._reauth_entry.data[CONF_URL]
            verify_ssl = self._reauth_entry.data.get(CONF_VERIFY_SSL, True)
            try:
                account = await _validate(self.hass, url, user_input[CONF_TOKEN], verify_ssl)
            except TaskTickAuthError:
                errors["base"] = "invalid_auth"
            except (TaskTickConnectionError, TaskTickError):
                errors["base"] = "cannot_connect"
            else:
                return self.async_update_reload_and_abort(
                    self._reauth_entry,
                    data_updates={CONF_TOKEN: user_input[CONF_TOKEN]},
                    reason="reauth_successful",
                )

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_TOKEN): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    )
                }
            ),
            description_placeholders={"url": self._reauth_entry.data[CONF_URL]},
            errors=errors,
        )

    # -- shared create ---------------------------------------------------- #

    async def _async_create(self, user_input: dict[str, Any]) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        try:
            url = normalize_url(user_input[CONF_URL])
        except ValueError:
            return self.async_show_form(
                step_id=self._current_step(),
                data_schema=_schema(user_input),
                errors={CONF_URL: "invalid_url"},
            )

        try:
            account = await _validate(
                self.hass, url, user_input[CONF_TOKEN], user_input.get(CONF_VERIFY_SSL, True)
            )
        except TaskTickAuthError:
            errors["base"] = "invalid_auth"
        except TaskTickConnectionError:
            errors["base"] = "cannot_connect"
        except TaskTickError:
            errors["base"] = "unknown"
        else:
            await self.async_set_unique_id(url)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=f"TaskTick ({account.get('name') or origin_of(url)})",
                data={
                    CONF_URL: url,
                    CONF_TOKEN: user_input[CONF_TOKEN],
                    CONF_VERIFY_SSL: user_input.get(CONF_VERIFY_SSL, True),
                },
            )

        return self.async_show_form(
            step_id=self._current_step(),
            data_schema=_schema(user_input),
            errors=errors,
        )

    def _current_step(self) -> str:
        return "zeroconf_confirm" if self._discovered else "user"

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> TaskTickOptionsFlow:
        return TaskTickOptionsFlow()


class TaskTickOptionsFlow(OptionsFlow):
    """Scan interval, and whether to keep verifying TLS.

    Both are things that legitimately change after setup: a busy instance may
    want a longer interval, and a self-signed certificate on the LAN is common
    enough that turning verification off should not require deleting the entry.
    """

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        current = self.config_entry.options.get(
            "scan_interval", int(DEFAULT_SCAN_INTERVAL.total_seconds())
        )
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional("scan_interval", default=current): NumberSelector(
                        NumberSelectorConfig(
                            min=MIN_SCAN_SECONDS,
                            max=MAX_SCAN_SECONDS,
                            step=1,
                            mode=NumberSelectorMode.BOX,
                            unit_of_measurement="s",
                        )
                    ),
                    vol.Optional(
                        CONF_VERIFY_SSL,
                        default=self.config_entry.options.get(
                            CONF_VERIFY_SSL, self.config_entry.data.get(CONF_VERIFY_SSL, True)
                        ),
                    ): BooleanSelector(),
                }
            ),
        )
