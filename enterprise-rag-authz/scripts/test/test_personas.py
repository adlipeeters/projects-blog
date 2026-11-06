from check_tokens import problems
from erag.authz import ADMIN_GROUP, READ_GROUPS
from personas import PERSONAS


def test_there_are_eight_personas_with_known_groups() -> None:
    assert len({persona.username for persona in PERSONAS}) == 8
    for persona in PERSONAS:
        assert persona.groups <= READ_GROUPS | {ADMIN_GROUP}
        assert "all-staff" in persona.groups


def test_admins_hold_no_department_group() -> None:
    admins = [persona for persona in PERSONAS if ADMIN_GROUP in persona.groups]
    assert len(admins) == 2
    assert all(persona.groups == {"all-staff", ADMIN_GROUP} for persona in admins)


def test_token_check_spots_a_wrong_tenant_and_wrong_groups() -> None:
    persona = PERSONAS[0]
    good = {
        "token_use": "access",
        "tenant_id": persona.tenant_id,
        "cognito:groups": sorted(persona.groups),
    }
    assert problems(persona, good) == []
    assert problems(persona, {**good, "tenant_id": "brightmoor"})
    assert problems(persona, {**good, "cognito:groups": ["hr"]})
    assert problems(persona, {**good, "token_use": "id"})
