import pytest
from maintenance import validate_budget_floors
def test_extra_retained_reservations_do_not_reset_or_break_restore():
    validate_budget_floors({'model':{'cap':40,'reserved':9}}, {'model':{'cap':40,'reserved':7}})
@pytest.mark.parametrize('actual',[{'model':{'cap':40,'reserved':0}},{'model':{'cap':41,'reserved':9}},{}])
def test_lost_counter_changed_cap_or_missing_scope_is_not_accepted(actual):
    with pytest.raises(ValueError):validate_budget_floors(actual,{'model':{'cap':40,'reserved':7}})
