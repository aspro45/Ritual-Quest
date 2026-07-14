import oauthHandler from "./oauth.js";

export default function discordCallback(request, response) {
  request.query = {
    ...(request.query || {}),
    action: "callback",
    provider: "discord"
  };

  return oauthHandler(request, response);
}
