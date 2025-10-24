// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./VerifySignLib.sol";

contract PredictProposalVote is Ownable {
    using SafeERC20 for IERC20;

    mapping(uint64 => mapping(uint64 => mapping(address => VoteRecord)))
        public voteRecord;
    address public authorizer;

    struct VoteRecord {
        uint64 proposalID;
        uint64 optionIdx;
        address voter;
        uint64 uid;
        uint64 amount;
    }

    struct VerifySignData {
        VoteRecord data;
        uint64 deadline;
        bytes signature;
    }

    event Voted(
        uint64 indexed proposalID,
        uint64 indexed optionIdx,
        address indexed voter,
        uint64 uid,
        uint64 amount
    );
    event AuthorizerChanged(address indexed authorizer);

    constructor(address _authorizer) Ownable(msg.sender) {
        require(_authorizer != address(0), "Vote: Invalid initial authorizer");
        authorizer = _authorizer;
    }

    function _verifySign(VerifySignData memory sign) internal view {
        bytes32 msgHash = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                sign.data.proposalID,
                sign.data.optionIdx,
                sign.data.voter,
                sign.data.uid,
                sign.data.amount,
                sign.deadline
            )
        );

        VerifySignLib.requireValidSignature(
            authorizer,
            msgHash,
            sign.signature
        );
    }

    function vote(
        uint64 _proposalID,
        uint64 _optionIdx,
        uint64 _uid,
        uint64 _amount,
        uint64 _deadline,
        bytes memory _signature
    ) public {
        require(
            block.timestamp <= _deadline,
            "Vote: The signature has expired"
        );

        require(_amount > 0, "Vote: Amount must be greater than zero");

        VoteRecord memory data = VoteRecord(
            _proposalID,
            _optionIdx,
            _msgSender(),
            _uid,
            _amount
        );

        _verifySign(VerifySignData(data, _deadline, _signature));

        VoteRecord storage record = voteRecord[_proposalID][_optionIdx][
            _msgSender()
        ];

        if (record.proposalID == 0) {
            record.proposalID = data.proposalID;
            record.optionIdx = data.optionIdx;
            record.voter = data.voter;
            record.uid = data.uid;
        } else {
            require(record.uid == data.uid, "Vote: uid not match");
        }
        record.amount += data.amount;

        emit Voted(
            data.proposalID,
            data.optionIdx,
            data.voter,
            data.uid,
            data.amount
        );
    }

    /// @notice Set authorizer address.
    /// @dev Only owner can execute.
    /// @param _authorizer Authorizer address.
    function setAuthorizer(address _authorizer) external onlyOwner {
        require(
            _authorizer != authorizer && _authorizer != address(0),
            "Vote: authorizer not changed or authorizer invalid"
        );
        authorizer = _authorizer;
        emit AuthorizerChanged(_authorizer);
    }
}
