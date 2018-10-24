use super::{MouseDownData, MOUSE_DOWN_DATA};

/// A rectangular region of 2D space
#[derive(Clone, PartialEq, Debug)]
pub struct SelectionRegion {
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
}

/// Represents a rectangle of space that was either added or removed from the selection region.
#[derive(Clone, PartialEq, Debug)]
pub struct ChangedRegion {
    pub was_added: bool,
    pub region: SelectionRegion,
}

#[inline(always)]
fn min_max(n1: usize, n2: usize) -> (usize, usize) {
    if n2 < n1 {
        (n2, n1)
    } else {
        (n1, n2)
    }
}

pub struct SelectionRegionPointIterator<'a> {
    i: usize,
    region: &'a SelectionRegion,
}

impl<'a> SelectionRegionPointIterator<'a> {
    pub fn new(region: &'a SelectionRegion) -> Self {
        SelectionRegionPointIterator { i: 0, region }
    }
}

impl<'a> Iterator for SelectionRegionPointIterator<'a> {
    type Item = (usize, usize);

    fn next(&mut self) -> Option<(usize, usize)> {
        if self.i > 3 {
            return None;
        }

        let pt = match self.i {
            0 => (self.region.x, self.region.y),
            1 => (self.region.x + self.region.width, self.region.y),
            2 => (self.region.x, self.region.y + self.region.height),
            3 => (
                self.region.x + self.region.width,
                self.region.y + self.region.height,
            ),
            _ => unreachable!(),
        };

        self.i += 1;
        Some(pt)
    }
}

impl SelectionRegion {
    pub fn from_points(x1: usize, y1: usize, x2: usize, y2: usize) -> Self {
        let (minx, maxx) = min_max(x1, x2);
        let (miny, maxy) = min_max(y1, y2);

        SelectionRegion {
            x: minx,
            y: miny,
            width: maxx - minx,
            height: maxy - miny,
        }
    }

    pub fn diff(
        &self,
        origin_x: usize,
        origin_y: usize,
        other: &Self,
    ) -> (Option<SelectionRegion>, ChangedRegion, ChangedRegion) {
        let sum_origin = (self.x.min(other.x), self.y.min(other.y));
        let sum_rev_origin = (
            (self.x + self.width).max(other.x + other.width),
            (self.y + self.height).max(other.y + other.height),
        );

        let sum_width = sum_rev_origin.0 - sum_origin.0;
        let sum_height = sum_rev_origin.1 - sum_origin.1;

        let x_diff_left = self.x.max(other.x) - sum_origin.0;
        let x_diff_right = sum_rev_origin.0 - (self.x + self.width).min(other.x + other.width);
        let y_diff_top = self.y.max(other.y) - sum_origin.1;
        let y_diff_bottom = sum_rev_origin.1 - (self.y + self.height).min(other.y + other.height);

        let y_crossed = (self.x >= origin_x) != (other.x >= origin_x);
        let x_crossed = (self.y >= origin_y) != (other.y >= origin_y);

        if !x_crossed && !y_crossed {
            // the start and end x coordinates of the difference in horizontal space between
            // the old and new regions
            let (x_region_added, x_region_bounds) = if x_diff_left > 0 {
                let bounds = (sum_origin.0, sum_origin.0 + x_diff_left);
                let added = other.x == sum_origin.0;
                (added, bounds)
            } else {
                let bounds = (sum_rev_origin.0 - x_diff_right, sum_rev_origin.0);
                let added = (other.x + other.width) == sum_rev_origin.0;
                (added, bounds)
            };

            // the start and end y coordinates of the difference in vertical space between
            // the old and new regions
            let (y_region_added, y_region_bounds) = if y_diff_top > 0 {
                let bounds = (sum_origin.1, sum_origin.1 + y_diff_top);
                let added = other.y == sum_origin.1;
                (added, bounds)
            } else {
                let bounds = (sum_rev_origin.1 - y_diff_bottom, sum_rev_origin.1);
                let added = (other.y + other.height) == sum_rev_origin.1;
                (added, bounds)
            };

            let x_region_length = x_region_bounds.1 - x_region_bounds.0;
            let y_region_height = y_region_bounds.1 - y_region_bounds.0;

            let retained_x = self.x.max(other.x);
            let retained_y = self.y.max(other.y);
            let min_max_x = (self.x + self.width).min(other.x + other.width);
            let min_max_y = (self.y + self.height).min(other.y + other.height);
            let retained_region = SelectionRegion {
                x: retained_x,
                y: retained_y,
                width: min_max_x - retained_x,
                height: min_max_y - retained_y,
            };

            (
                Some(retained_region),
                ChangedRegion {
                    was_added: x_region_added,
                    region: SelectionRegion {
                        x: x_region_bounds.0,
                        // subtract the intersecting area from this axis unless both of the changes
                        // are the same type, in which case we include the intersecting area in
                        // this region.
                        y: if x_region_added == y_region_added {
                            sum_origin.1
                        } else if y_diff_top > 0 {
                            // intersecting region is on top, so bound by that region's bottom
                            y_region_bounds.1
                        } else {
                            // intersecting region is below, don't bound and subtract from
                            // height later on
                            sum_origin.1
                        },
                        width: x_region_length,
                        // subtract the height of the intersecting region unless we're including it
                        // in which case we take the full height of the summed area
                        height: if x_region_added == y_region_added {
                            sum_height
                        } else {
                            sum_height - y_region_height
                        },
                    },
                },
                ChangedRegion {
                    was_added: y_region_added,
                    region: SelectionRegion {
                        // subtract the intersecting area from this axis
                        x: if x_diff_left > 0 {
                            // bounded by the right side of the x region
                            x_region_bounds.1
                        } else {
                            // intersecting region is to our right, so don't bound and handle
                            // it by subtracting from width later on.
                            sum_origin.0
                        },
                        y: y_region_bounds.0,
                        width: sum_width - x_region_length,
                        height: y_region_height,
                    },
                },
            )
        } else {
            // swapping over the origin means that the two regions must be disjoint, so the
            // changed regions are the regions themselves.
            (
                None,
                ChangedRegion {
                    was_added: false,
                    region: self.clone(),
                },
                ChangedRegion {
                    was_added: true,
                    region: other.clone(),
                },
            )
        }
    }

    pub fn iter_points(&'_ self) -> SelectionRegionPointIterator<'_> {
        SelectionRegionPointIterator::new(&self)
    }

    pub fn contains_point(&self, pt: (usize, usize)) -> bool {
        pt.0 >= self.x
            && pt.0 <= (self.x + self.width)
            && pt.1 >= self.y
            && pt.1 <= (self.y + self.height)
    }
}

pub struct SelectionBoxData {
    pub retained_region: Option<SelectionRegion>,
    pub region: SelectionRegion,
    pub changed_region_1: ChangedRegion,
    pub changed_region_2: ChangedRegion,
}

impl SelectionBoxData {
    pub fn compute(x: usize, y: usize, last_x: usize, last_y: usize) -> Self {
        let &MouseDownData {
            x: down_x,
            y: down_y,
            ..
        } = unsafe { &MOUSE_DOWN_DATA };
        let region = SelectionRegion::from_points(down_x, down_y, x, y);
        let last_region = SelectionRegion::from_points(down_x, down_y, last_x, last_y);
        // common::log(format!("{:?} -> {:?}", last_region, region));
        let (retained_region, changed_region_1, changed_region_2) =
            last_region.diff(down_x, down_y, &region);

        SelectionBoxData {
            retained_region,
            region,
            changed_region_1,
            changed_region_2,
        }
    }
}
