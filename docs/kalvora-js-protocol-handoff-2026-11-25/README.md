# kalvora.js protocol handoff

Open the [SDK migration guide](documents/howto/kalvora_js_protocol_handoff.md) for the implementation order, SDK file locations and acceptance tests.

The flat schema directory is `kal_validator/proto/`. Pass its extracted path to kalvora.js with `npm run proto:sync -- --source <directory>`. The existing sync tool selects the three public schemas.

The archive includes the two public fixture files, directly referenced validator sources and guides, and SHA-256 checksums of the included files. Links from the reference material into the wider validator tree can be followed in a full checkout.
