use serde::de::{self, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::fmt;

pub const MAX_BATCH: usize = 12;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CreditAck {
    pub id: u32,
    pub seq: u32,
}

#[derive(Debug)]
pub struct CreditBatch(Vec<CreditAck>);

impl CreditBatch {
    pub fn as_slice(&self) -> &[CreditAck] {
        &self.0
    }
}

impl<'de> Deserialize<'de> for CreditBatch {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct BatchVisitor;
        impl<'de> Visitor<'de> for BatchVisitor {
            type Value = CreditBatch;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("1 through 12 unique session acknowledgements")
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut input: A) -> Result<Self::Value, A::Error> {
                let mut acks: Vec<CreditAck> = Vec::with_capacity(MAX_BATCH);
                while let Some(ack) = input.next_element::<CreditAck>()? {
                    if acks.len() == MAX_BATCH {
                        return Err(de::Error::custom("credit batch exceeds 12 entries"));
                    }
                    if ack.id == 0 || ack.seq == 0 {
                        return Err(de::Error::custom("credit id and sequence must be positive"));
                    }
                    if acks.iter().any(|old| old.id == ack.id) {
                        return Err(de::Error::custom("duplicate session in credit batch"));
                    }
                    acks.push(ack);
                }
                if acks.is_empty() {
                    return Err(de::Error::custom("empty credit batch"));
                }
                Ok(CreditBatch(acks))
            }
        }
        deserializer.deserialize_seq(BatchVisitor)
    }
}

pub fn register<T>(
    batch: &CreditBatch,
    mut lookup: impl FnMut(u32) -> Option<T>,
    mut apply: impl FnMut(T, u32),
) -> Result<(), String> {
    let handles = batch
        .as_slice()
        .iter()
        .map(|ack| {
            lookup(ack.id)
                .map(|handle| (handle, ack.seq))
                .ok_or_else(|| "no bench session".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    for (handle, seq) in handles {
        apply(handle, seq);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn parse(json: &str) -> Result<CreditBatch, serde_json::Error> {
        serde_json::from_str(json)
    }

    #[test]
    fn credit_batch_is_bounded_strict_and_unique_per_session() {
        let json = serde_json::to_string(
            &(1..=12)
                .map(|id| serde_json::json!({"id":id,"seq":7}))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        let batch = parse(&json).unwrap();
        assert_eq!(batch.as_slice().len(), 12);
        for json in [
            "[]",
            "[{\"id\":0,\"seq\":1}]",
            "[{\"id\":1,\"seq\":0}]",
            "[{\"id\":1,\"seq\":1,\"extra\":0}]",
            "[{\"id\":1,\"seq\":1},{\"id\":1,\"seq\":2}]",
        ] {
            assert!(parse(json).is_err(), "{json}");
        }
        let too_many = serde_json::to_string(
            &(1..=13)
                .map(|id| serde_json::json!({"id":id,"seq":1}))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert!(parse(&too_many).unwrap_err().to_string().contains("12"));
    }

    #[test]
    fn registration_resolves_every_session_before_any_control_is_changed() {
        let batch = parse("[{\"id\":1,\"seq\":4},{\"id\":2,\"seq\":5}]").unwrap();
        let applied = RefCell::new(Vec::new());
        assert!(register(
            &batch,
            |id| (id == 1).then_some(id),
            |id, seq| applied.borrow_mut().push((id, seq))
        )
        .is_err());
        assert!(applied.borrow().is_empty());
        register(&batch, Some, |id, seq| applied.borrow_mut().push((id, seq))).unwrap();
        assert_eq!(*applied.borrow(), vec![(1, 4), (2, 5)]);
    }
}
